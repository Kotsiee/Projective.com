import {
	addDays,
	type AvailabilityKind,
	type AvailabilityPreset,
	type AvailabilityRuleDraft,
	type Band,
	type DateRange,
	draftToRRule,
	intersectBands,
	type IsoDate,
	type Issue,
	type OwnerBand,
	type PresetLike,
	type PresetScope,
	rruleToDraft,
	type RuleEffect,
	type SavePresetInput,
	unionBands,
	zonedSpan,
} from "@projective/types/scheduling";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { fail, type ServiceResult } from "../ServiceResult.ts";

/**
 * preset-model — the PURE half of availability presets (plan §5.5–§5.6): stored rows to the authored
 * preset and back, the compile window, the weekly mirror of the default preset, the service fork, and
 * what a `scheduling.*` preset door's refusal means. No IO, so every rule here is tested without a
 * database; `live-presets.ts` and `live-occurrences.ts` do the reading and writing.
 */

// #region Rows
/** A `scheduling.availability_presets` row as {@link PRESET_COLUMNS} selects it. */
export interface PresetRow {
	id: string;
	schedule_id: string;
	scope: PresetScope;
	blueprint_id: string | null;
	name: string;
	description: string;
	is_default: boolean;
	compiled_from: string | null;
	compiled_through: string | null;
	archived_at: string | null;
}

/** A `scheduling.recurrence_rules` row as {@link RULE_COLUMNS} selects it. */
export interface RuleRow {
	id: string;
	preset_id: string;
	kind: AvailabilityKind;
	effect: RuleEffect;
	rrule: string;
	starts_on: string;
	ends_on: string | null;
	priority: number;
	unless_weekdays: number[] | null;
	label: string;
	is_active: boolean;
	position: number;
}

/** A `scheduling.recurrence_rule_bands` row. */
export interface RuleBandRow {
	rule_id: string;
	position: number;
	start_minute: number;
	end_minute: number;
}

export const PRESET_COLUMNS =
	"id, schedule_id, scope, blueprint_id, name, description, is_default, compiled_from, compiled_through, archived_at";
export const RULE_COLUMNS =
	"id, preset_id, kind, effect, rrule, starts_on, ends_on, priority, unless_weekdays, label, is_active, position";
export const BAND_COLUMNS = "rule_id, position, start_minute, end_minute";

/**
 * A stored rule whose RRULE no draft pattern expresses. Only the service writes rules, and only from
 * drafts, so this means the row was written some other way — refused loudly, never approximated.
 */
export class UnreadableRuleError extends Error {
	constructor(ruleId: string, rrule: string) {
		super(`recurrence rule ${ruleId} (${rrule}) is not an authored pattern`);
		this.name = "UnreadableRuleError";
	}
}

function ruleFromRow(row: RuleRow, bands: readonly RuleBandRow[]): AvailabilityRuleDraft {
	const startsOn = row.starts_on as IsoDate;
	const recurrence = rruleToDraft(row.rrule, startsOn);
	if (!recurrence) throw new UnreadableRuleError(row.id, row.rrule);
	return {
		id: row.id,
		layer: row.kind,
		effect: row.effect,
		pattern: recurrence.pattern,
		condition: recurrence.condition,
		bands: bands
			.filter((b) => b.rule_id === row.id)
			.sort((a, b) => a.position - b.position)
			.map((b) => ({ start: b.start_minute, end: b.end_minute })),
		startsOn,
		endsOn: recurrence.endsOn,
		priority: row.priority,
		label: row.label,
		active: row.is_active,
	};
}

/** The authored preset a stored row, its rules and their bands describe, in its schedule's zone. */
export function presetFromRows(
	preset: PresetRow,
	rules: readonly RuleRow[],
	bands: readonly RuleBandRow[],
	timezone: string,
): AvailabilityPreset {
	return {
		id: preset.id,
		name: preset.name,
		description: preset.description,
		timezone,
		isDefault: preset.is_default,
		scope: preset.scope,
		blueprintId: preset.blueprint_id,
		rules: rules
			.filter((r) => r.preset_id === preset.id)
			.sort((a, b) => a.position - b.position)
			.map((r) => ruleFromRow(r, bands)),
		archivedAt: preset.archived_at,
	};
}
// #endregion

// #region Save payload
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `scheduling.save_availability_preset` payload for a validated save. A rule keeps its uuid; a
 * client id (`rule-3`) is dropped so the door mints one. Throws `RecurrenceError` for a recurrence
 * the schema would have refused.
 */
export function presetPayload(input: SavePresetInput): Record<string, unknown> {
	return {
		...(input.id ? { id: input.id } : {}),
		name: input.name,
		description: input.description,
		is_default: input.isDefault,
		scope: input.scope,
		blueprint_id: input.blueprintId,
		rules: input.rules.map((r) => ({
			...(UUID_RE.test(r.id) ? { id: r.id } : {}),
			kind: r.layer,
			effect: r.effect,
			rrule: draftToRRule(r),
			starts_on: r.startsOn,
			ends_on: r.endsOn,
			priority: r.priority,
			unless_weekdays: r.condition.unlessWeekdays,
			label: r.label,
			is_active: r.active,
			bands: r.bands.map((b) => ({ start_minute: b.start, end_minute: b.end })),
		})),
	};
}

/** The issues that block a save — `validate()`'s errors (`rrule_invalid`, `overlapping_bands`). */
export function hardIssues(issues: readonly Issue[]): Issue[] {
	return issues.filter((i) => i.severity === "error");
}

/** Hard issues keyed by the field path of the rule they name, for a 422. */
export function issueErrors(
	issues: readonly Issue[],
	rules: readonly Pick<AvailabilityRuleDraft, "id">[],
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of issues) {
		const index = rules.findIndex((r) => r.id === issue.ruleId);
		const key = index >= 0 ? `rules.${index}` : "rules";
		errors[key] ??= issue.message;
	}
	return errors;
}
// #endregion

// #region Compile window
/** The default compile horizon in days (plan §5.6). */
export const COMPILE_HORIZON_DAYS = 120;

/** A preset compiled through an earlier date than today + this is recompiled by the horizon job. */
export const RECOMPILE_WITHIN_DAYS = 90;

/** What one compile covers: the local dates evaluated, and the instants the occurrence door replaces. */
export interface CompileWindow {
	range: DateRange;
	/** Local midnight of `range.from`, epoch ms. */
	from: number;
	/** Local midnight after `range.to`, epoch ms. */
	to: number;
}

/** The window a compile from the owner's `today` covers: `today` through `today + horizonDays`. */
export function compileWindow(
	today: IsoDate,
	horizonDays: number,
	timezone: string,
): CompileWindow {
	const to = addDays(today, horizonDays);
	return {
		range: { from: today, to },
		from: zonedSpan(today, 0, 0, timezone).startsAt,
		to: zonedSpan(addDays(to, 1), 0, 0, timezone).startsAt,
	};
}

/** Whether the horizon job should recompile a preset compiled through `compiledThrough`. */
export function needsRecompile(compiledThrough: string | null, today: IsoDate): boolean {
	return compiledThrough === null || compiledThrough < addDays(today, RECOMPILE_WITHIN_DAYS);
}
// #endregion

// #region Weekly mirror
/** The weekly bands a default preset is mirrored into, and whether they say all it says. */
export interface MirrorProjection {
	bands: OwnerBand[];
	/** `false` when some active rule is richer than a weekly band, or the bands exceed the editor's 42. */
	full: boolean;
}

const MAX_WEEKLY_BANDS = 42;

/**
 * Whether a rule is a weekly band in disguise: an active, open-ended, every-week `add` rule already in
 * force on `today`. Anything else has no `availability_rules` equivalent.
 */
function isWeeklyBand(rule: AvailabilityRuleDraft, today: IsoDate): boolean {
	return rule.effect === "add" && rule.pattern.type === "weekly" && rule.pattern.interval === 1 &&
		rule.endsOn === null && rule.startsOn <= today && rule.condition.unlessWeekdays.length === 0;
}

/**
 * Project a preset onto the weekly bands `/[handle]/availability` and discovery calls still read
 * (plan §5.6 step 4). Bands of one day and layer are merged; call windows are clipped to working
 * hours, as the evaluator clips them. `full` tells the editor whether to explain the gap.
 */
export function mirrorProjection(preset: PresetLike, today: IsoDate): MirrorProjection {
	const active = preset.rules.filter((r) => r.active);
	const weekly = active.filter((r) => isWeeklyBand(r, today));
	const bandsOn = (layer: AvailabilityKind, weekday: number): Band[] =>
		unionBands(
			...weekly
				.filter((r) =>
					r.layer === layer && r.pattern.type === "weekly" && r.pattern.days.includes(weekday)
				)
				.map((r) => r.bands),
		);

	const bands: OwnerBand[] = [];
	for (let weekday = 0; weekday < 7; weekday++) {
		const working = bandsOn("working_hours", weekday);
		const calls = intersectBands(bandsOn("call_window", weekday), working);
		for (const [kind, list] of [["working_hours", working], ["call_window", calls]] as const) {
			for (const b of list) {
				bands.push({ weekday, startMinute: b.start, endMinute: b.end, kind });
			}
		}
	}
	const fits = bands.length <= MAX_WEEKLY_BANDS;
	return {
		bands: fits ? bands : bands.slice(0, MAX_WEEKLY_BANDS),
		full: fits && weekly.length === active.length,
	};
}
// #endregion

// #region Fork
/**
 * The save that forks `source` into `blueprintId`'s own service preset, or rewrites its existing
 * fork (`forkId`). The rules are copied under fresh client ids, because a rule id belongs to exactly
 * one preset; the fork keeps the source's name, which a service preset may share.
 */
export function forkInput(
	source: AvailabilityPreset,
	blueprintId: string,
	forkId: string | null,
): SavePresetInput {
	return {
		...(forkId ? { id: forkId } : {}),
		name: source.name,
		description: source.description,
		timezone: source.timezone,
		isDefault: false,
		scope: "service",
		blueprintId,
		rules: source.rules.map((r, i) => ({ ...r, id: `rule-${i + 1}` })),
	};
}
// #endregion

// #region Refusals
/** A PostgREST error as a preset door raises it. */
export interface PresetDoorError {
	code?: string;
	message: string;
}

const INVALID = new Set(["22023", "23514", "23505", "22P02"]);

/** `rules.2.starts_on` → `rules.2.startsOn`. */
function fieldOf(raw: string): string {
	return raw.split(".").map((p) => p.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()))
		.join(".");
}

/** `name: give the preset a name` → the field and the sentence. */
function split(message: string): { field: string | null; sentence: string } {
	const match = /^([a-z_]+(?:\.[a-z0-9_]+)*):\s*(.+)$/i.exec(message.trim());
	const sentence = (match ? match[2] : message).replace(/\s+/g, " ").trim();
	const capitalised = sentence.charAt(0).toUpperCase() + sentence.slice(1);
	return { field: match ? fieldOf(match[1]) : null, sentence: capitalised.slice(0, 200) };
}

/**
 * A preset door's refusal as the result a route returns: the age gate (`PM403`) a 403 with the
 * restricted sentence, `42501` a 403, a missing preset a 404, and an input refusal (`<field>: <reason>`)
 * a 422 keyed by that field. Anything else is thrown, for the service's guard to answer as a 503.
 */
export function presetRefusal<T>(error: PresetDoorError): ServiceResult<T> {
	if (isAgeRestricted(error)) {
		return fail(AGE_RESTRICTED.status, {
			message: AGE_RESTRICTED.message,
			details: { reason: AGE_RESTRICTED.reason },
		});
	}
	const { field, sentence } = split(error.message);
	if (error.code === "42501") return fail(403, { message: sentence });
	if (error.code === "P0002") return fail(404, { message: "That preset no longer exists." });
	if (error.code && INVALID.has(error.code)) {
		return fail(422, { message: sentence, errors: field ? { [field]: sentence } : undefined });
	}
	throw new Error(`preset door failed (${error.code ?? "no code"}): ${error.message}`);
}
// #endregion
