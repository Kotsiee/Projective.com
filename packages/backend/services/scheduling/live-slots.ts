import type { SupabaseClient } from "supabaseClient";
import type { IsoDate } from "@projective/types/scheduling";
import { getAnonClient, getServiceClient } from "../../core/supabase.ts";
import {
	type CompiledAvailability,
	DEFAULT_GRID_RULES,
	type GridBand,
	type GridRules,
	type GridSource,
	type Span,
} from "./slot-grid.ts";

/**
 * live-slots — a provider's published schedule, read as the input the slot grid is built from.
 *
 * Everything here is PUBLIC shape and nothing more: the bands and blackout spans of a published
 * schedule (world-readable by policy), its booking guards (`call_settings`, likewise), and its busy
 * time as bare spans through `scheduling.get_free_busy` — the definer read that answers "this time is
 * taken" without saying by whom or for what. So the anonymous client answers a guest and a member
 * identically, and the grid a buyer is shown is the grid the database's booking gate will enforce.
 *
 * Returns `undefined` only when the database could not answer — never an empty schedule dressed up
 * as the provider's. An unpublished (or absent) schedule is a real answer: a CLOSED source with the
 * reason the picker prints.
 *
 * A booking FOR A LISTING also carries the listing's compiled preset (Decision #217 (d)) when its
 * blueprint resolves one — the same `scheduling.fn_preset_for_blueprint` the gate asks. Occurrences
 * carry no anon grant, so those spans are read through the service client; what they disclose is the
 * shape of the published schedule's open time, as the bands are.
 */

// #region Owner
/** Whose schedule: an individual is ONE schedule (`user`) whatever their freelancer flag; a team is `team`. */
export interface ScheduleOwner {
	type: "user" | "team" | "business" | "organisation";
	id: string;
}

/** Which bands a booking lands in: a discovery call in the call windows, paid work in working hours. */
export type BandKind = "call_window" | "working_hours";

/** The reason a grid is closed because the provider has published nothing to book. */
export const UNPUBLISHED_REASON = "This provider has not published their availability yet.";
// #endregion

// #region Rows
interface ScheduleRow {
	id: string;
	timezone: string;
	is_published: boolean;
}

interface BandRow {
	weekday: number;
	start_minute: number;
	end_minute: number;
}

interface GuardRow {
	min_notice_minutes: number;
	max_advance_days: number;
	buffer_before_minutes: number;
	buffer_after_minutes: number;
}

interface SpanRow {
	starts_at: string;
	ends_at: string;
}

function spanOf(row: SpanRow): Span {
	return { start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) };
}
// #endregion

// #region Compiled preset
interface PresetWindowRow {
	compiled_from: string | null;
	compiled_through: string | null;
}

/**
 * The compiled occurrences of the preset a blueprint books against, of one kind, over `window`.
 * `null` when the blueprint resolves no preset or it is not compiled — the weekly bands decide, as in
 * the gate. Throws when the database could not answer.
 */
export async function readCompiledAvailability(
	blueprintId: string,
	kind: BandKind,
	window: { from: number; to: number },
	db: SupabaseClient = getServiceClient(),
): Promise<CompiledAvailability | null> {
	const resolved = await db.schema("scheduling").rpc("fn_preset_for_blueprint", {
		p_blueprint: blueprintId,
	});
	if (resolved.error) throw new Error(`fn_preset_for_blueprint failed: ${resolved.error.message}`);
	const presetId = resolved.data as string | null;
	if (!presetId) return null;

	const preset = await db.schema("scheduling").from("availability_presets")
		.select("compiled_from, compiled_through")
		.eq("id", presetId)
		.maybeSingle();
	if (preset.error) throw new Error(`availability_presets read failed: ${preset.error.message}`);
	const row = preset.data as PresetWindowRow | null;
	if (!row?.compiled_from || !row.compiled_through) return null;

	const spans = await db.schema("scheduling").from("availability_occurrences")
		.select("starts_at, ends_at")
		.eq("preset_id", presetId)
		.eq("kind", kind)
		.lt("starts_at", new Date(window.to).toISOString())
		.gt("ends_at", new Date(window.from).toISOString());
	if (spans.error) throw new Error(`availability_occurrences read failed: ${spans.error.message}`);
	return {
		from: row.compiled_from as IsoDate,
		through: row.compiled_through as IsoDate,
		spans: ((spans.data ?? []) as SpanRow[]).map(spanOf),
	};
}
// #endregion

// #region The read
/** Where {@link readGridSource} reads from. */
export interface GridSourceOptions {
	/** The listing's blueprint, for a booking the gate judges against its preset. */
	blueprintId?: string | null;
	client?: SupabaseClient;
	compiledClient?: SupabaseClient;
}

/**
 * The grid source for an owner's schedule, over the window `[from, to)` (epoch ms). The caller sizes
 * the window to the rail it is about to draw; free/busy is clamped to 120 days by the database.
 */
export async function readGridSource(
	owner: ScheduleOwner,
	kind: BandKind,
	window: { from: number; to: number },
	options: GridSourceOptions = {},
): Promise<GridSource | undefined> {
	const client = options.client ?? getAnonClient();
	try {
		const schedule = await client.schema("scheduling").from("schedules")
			.select("id, timezone, is_published")
			.eq("owner_type", owner.type)
			.eq("owner_id", owner.id)
			.maybeSingle();
		if (schedule.error) return undefined;
		const row = schedule.data as ScheduleRow | null;
		if (!row || !row.is_published) return closedSource(row?.timezone ?? "UTC", UNPUBLISHED_REASON);

		const fromIso = new Date(window.from).toISOString();
		const toIso = new Date(window.to).toISOString();
		const [bands, blackouts, guards, busy] = await Promise.all([
			client.schema("scheduling").from("availability_rules")
				.select("weekday, start_minute, end_minute")
				.eq("schedule_id", row.id)
				.eq("kind", kind)
				.eq("is_active", true),
			client.schema("scheduling").rpc("get_public_blackouts", {
				p_schedule: row.id,
				p_from: fromIso,
				p_to: toIso,
			}),
			client.schema("scheduling").from("call_settings")
				.select("min_notice_minutes, max_advance_days, buffer_before_minutes, buffer_after_minutes")
				.eq("schedule_id", row.id)
				.maybeSingle(),
			client.schema("scheduling").rpc("get_free_busy", {
				p_schedule: row.id,
				p_from: fromIso,
				p_to: toIso,
			}),
		]);
		if (bands.error || blackouts.error || guards.error || busy.error) return undefined;

		const g = guards.data as GuardRow | null;
		const rules: GridRules = g
			? {
				minNoticeMinutes: g.min_notice_minutes,
				maxAdvanceDays: g.max_advance_days,
				bufferBeforeMinutes: g.buffer_before_minutes,
				bufferAfterMinutes: g.buffer_after_minutes,
			}
			: DEFAULT_GRID_RULES;
		const compiled = options.blueprintId
			? await readCompiledAvailability(options.blueprintId, kind, window, options.compiledClient)
			: null;

		return {
			timezone: row.timezone,
			compiled,
			bands: ((bands.data ?? []) as BandRow[]).map((b): GridBand => ({
				weekday: b.weekday,
				startMinute: b.start_minute,
				endMinute: b.end_minute,
			})),
			blackouts: ((blackouts.data ?? []) as SpanRow[]).map(spanOf),
			busy: ((busy.data ?? []) as SpanRow[]).map(spanOf),
			rules,
			closedReason: null,
		};
	} catch {
		return undefined;
	}
}

/**
 * The id of an owner's PUBLISHED schedule — what a booking is made against. `null` when the owner has
 * none or has not published it; `undefined` when the database could not answer.
 */
export async function scheduleIdOf(
	owner: ScheduleOwner,
	client: SupabaseClient = getAnonClient(),
): Promise<string | null | undefined> {
	try {
		const { data, error } = await client.schema("scheduling").from("schedules")
			.select("id, is_published")
			.eq("owner_type", owner.type)
			.eq("owner_id", owner.id)
			.maybeSingle();
		if (error) return undefined;
		const row = data as { id: string; is_published: boolean } | null;
		return row?.is_published ? row.id : null;
	} catch {
		return undefined;
	}
}

/** A schedule that offers nothing, with the sentence that says why. */
export function closedSource(timezone: string, reason: string): GridSource {
	return {
		timezone,
		bands: [],
		blackouts: [],
		busy: [],
		rules: DEFAULT_GRID_RULES,
		closedReason: reason,
	};
}
// #endregion
