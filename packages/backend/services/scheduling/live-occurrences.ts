import type { SupabaseClient } from "supabaseClient";
import {
	type BlackoutSpan,
	dateInZone,
	evaluate,
	toOccurrenceSpans,
} from "@projective/types/scheduling";
import { getServiceClient } from "../../core/supabase.ts";
import {
	BAND_COLUMNS,
	COMPILE_HORIZON_DAYS,
	compileWindow,
	needsRecompile,
	PRESET_COLUMNS,
	presetFromRows,
	type PresetRow,
	RECOMPILE_WITHIN_DAYS,
	RULE_COLUMNS,
	type RuleBandRow,
	type RuleRow,
} from "./preset-model.ts";

/**
 * live-occurrences — the COMPILER of availability presets (Decision #217 (d)): run the one evaluator
 * over a preset's rules and write the spans through the service-role door
 * `scheduling.replace_preset_occurrences`, which the booking gate then reads.
 *
 * Service role throughout, because the occurrence table has no client write path and a compile may be
 * run by the scheduler with nobody signed in. It decides nothing about who may edit a preset; it only
 * restates, as spans, rules somebody with that right already saved.
 */

// #region Compile
interface ScheduleZoneRow {
	timezone: string;
}

interface BlackoutRow {
	starts_at: string;
	ends_at: string;
}

/** One preset compiled: the spans written, or `null` when the preset is archived or gone. */
export interface CompileOutcome {
	spans: number;
	compiledThrough: string;
}

/**
 * Compile a live preset over its schedule's `today` → `today + horizonDays`, blackouts cut out, and
 * replace its occurrences in that window. `null` when there is no live preset to compile. Throws when
 * the database could not answer.
 */
export async function compilePreset(
	presetId: string,
	options: { horizonDays?: number; now?: number; db?: SupabaseClient } = {},
): Promise<CompileOutcome | null> {
	const db = options.db ?? getServiceClient();
	const now = options.now ?? Date.now();
	const scheduling = db.schema("scheduling");

	const presetRead = await scheduling.from("availability_presets").select(PRESET_COLUMNS)
		.eq("id", presetId).is("archived_at", null).maybeSingle();
	if (presetRead.error) {
		throw new Error(`availability_presets read failed: ${presetRead.error.message}`);
	}
	const preset = presetRead.data as PresetRow | null;
	if (!preset) return null;

	const scheduleRead = await scheduling.from("schedules").select("timezone")
		.eq("id", preset.schedule_id).maybeSingle();
	if (scheduleRead.error) throw new Error(`schedules read failed: ${scheduleRead.error.message}`);
	const timezone = (scheduleRead.data as ScheduleZoneRow | null)?.timezone;
	if (!timezone) throw new Error(`schedule ${preset.schedule_id} has no time zone`);

	const window = compileWindow(
		dateInZone(now, timezone),
		options.horizonDays ?? COMPILE_HORIZON_DAYS,
		timezone,
	);
	const rulesRead = await scheduling.from("recurrence_rules").select(RULE_COLUMNS)
		.eq("preset_id", presetId);
	if (rulesRead.error) throw new Error(`recurrence_rules read failed: ${rulesRead.error.message}`);
	const rules = (rulesRead.data ?? []) as RuleRow[];
	const [bandsRead, blackoutsRead] = await Promise.all([
		rules.length
			? scheduling.from("recurrence_rule_bands").select(BAND_COLUMNS)
				.in("rule_id", rules.map((r) => r.id))
			: Promise.resolve({ data: [], error: null }),
		scheduling.from("blackout_dates").select("starts_at, ends_at")
			.eq("schedule_id", preset.schedule_id)
			.lt("starts_at", new Date(window.to).toISOString())
			.gt("ends_at", new Date(window.from).toISOString()),
	]);
	if (bandsRead.error) {
		throw new Error(`recurrence_rule_bands read failed: ${bandsRead.error.message}`);
	}
	if (blackoutsRead.error) {
		throw new Error(`blackout_dates read failed: ${blackoutsRead.error.message}`);
	}

	const authored = presetFromRows(preset, rules, (bandsRead.data ?? []) as RuleBandRow[], timezone);
	const blackouts: BlackoutSpan[] = ((blackoutsRead.data ?? []) as BlackoutRow[]).map((b) => ({
		startsAt: Date.parse(b.starts_at),
		endsAt: Date.parse(b.ends_at),
	}));
	const spans = toOccurrenceSpans(evaluate(authored, window.range, blackouts));

	const { data, error } = await scheduling.rpc("replace_preset_occurrences", {
		p_preset: presetId,
		p_from: new Date(window.from).toISOString(),
		p_to: new Date(window.to).toISOString(),
		p_spans: spans,
	});
	if (error) throw new Error(`replace_preset_occurrences failed: ${error.message}`);
	return { spans: Number(data ?? spans.length), compiledThrough: window.range.to };
}
// #endregion

// #region Horizon
interface HorizonRow {
	id: string;
	compiled_through: string | null;
	schedules: ScheduleZoneRow | ScheduleZoneRow[] | null;
}

function zoneOf(embedded: HorizonRow["schedules"]): string {
	const row = Array.isArray(embedded) ? embedded[0] : embedded;
	return row?.timezone ?? "UTC";
}

/** What one horizon sweep did. */
export interface HorizonOutcome {
	/** Presets recompiled. */
	presets: number;
	/** Presets whose compile failed; each is logged and retried by the next sweep. */
	failed: number;
}

/**
 * Recompile every live preset that is not compiled, or is compiled through an earlier date than
 * today + {@link RECOMPILE_WITHIN_DAYS} in its own zone — at most `limit` per run, least compiled
 * first. Idempotent: a recompile replaces the window it covers.
 */
export async function extendPresetHorizons(
	options: { limit?: number; now?: number; db?: SupabaseClient } = {},
): Promise<HorizonOutcome> {
	const db = options.db ?? getServiceClient();
	const now = options.now ?? Date.now();
	const limit = options.limit ?? 200;
	const cutoff = new Date(now + (RECOMPILE_WITHIN_DAYS + 1) * 86_400_000).toISOString().slice(
		0,
		10,
	);

	const { data, error } = await db.schema("scheduling").from("availability_presets")
		.select("id, compiled_through, schedules(timezone)")
		.is("archived_at", null)
		.or(`compiled_through.is.null,compiled_through.lt.${cutoff}`)
		.order("compiled_through", { ascending: true, nullsFirst: true })
		.limit(limit);
	if (error) throw new Error(`availability_presets horizon read failed: ${error.message}`);

	const due = ((data ?? []) as HorizonRow[]).filter((p) =>
		needsRecompile(p.compiled_through, dateInZone(now, zoneOf(p.schedules)))
	);

	let presets = 0;
	let failed = 0;
	for (const preset of due) {
		try {
			if (await compilePreset(preset.id, { now, db })) presets++;
		} catch (err) {
			failed++;
			console.error(
				`[scheduling:horizon] preset ${preset.id} did not compile`,
				err instanceof Error ? err.message : err,
			);
		}
	}
	return { presets, failed };
}
// #endregion
