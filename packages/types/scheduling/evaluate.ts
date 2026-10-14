import { addDays, type DateRange, eachDate, type IsoDate, zonedSpan } from "./civil.ts";
import type { OccurrenceInstant } from "./presets.ts";
import {
	type AvailabilityPreset,
	type AvailabilityRuleDraft,
	type Band,
	compileRecurrence,
	RECURRENCE_REFUSAL_COPY,
} from "./recurrence.ts";
import {
	expandRRule,
	parseRRule,
	RRULE_REFUSAL_COPY,
	type RRuleParts,
	serialiseRRule,
} from "./rrule.ts";
import type { AvailabilityKind } from "./rows.ts";

/**
 * scheduling.evaluate — THE availability evaluator (Decision #217 (d)): one pure implementation
 * the editor preview, the occurrence compiler and the booking gate's compiled spans all share.
 *
 * Per local date D, in the preset's zone, for each layer (plan §5.2):
 *  1. base = the union of every active `add` rule occurring on D;
 *  2. an active `replace` rule on D replaces base — highest priority, then the most recent
 *     `startsOn`, then the lowest id;
 *  3. every active `subtract` rule on D removes its bands; one with no bands removes the day;
 *  4. `call_window` is clipped to `working_hours` — never the reverse;
 *  5. bands become absolute spans (DST gap → the gap's end; overlap → the first occurrence);
 *  6. blackouts (absolute) are cut out, and spans touching across midnight are joined.
 *
 * Pure: no clock. Anything that needs "today" takes it as an argument.
 */

// #region Types
/** The slice of a preset the evaluator reads, so templates (which have no ids) evaluate too. */
export type PresetLike = Pick<AvailabilityPreset, "timezone" | "rules">;

/** An evaluated span on the timeline. */
export type Occurrence = OccurrenceInstant;

/** An absolute blackout from `scheduling.blackout_dates`, epoch milliseconds. */
export interface BlackoutSpan {
	startsAt: number;
	endsAt: number;
	label?: string;
	labelIsPublic?: boolean;
}

/** A rule as an explanation names it. */
export interface RuleRef {
	ruleId: string;
	label: string;
	bands: Band[];
}

/** A subtract rule that occurred, and what it actually took away. */
export interface RemovalRef extends RuleRef {
	removed: Band[];
}

/** Why one layer of one date looks the way it does. */
export interface LayerExplanation {
	layer: AvailabilityKind;
	/** The final local bands, after steps 1–4. */
	bands: Band[];
	/** `add` rules that occurred on the date (discarded when {@link replacedBy} is set). */
	contributed: RuleRef[];
	/** The `replace` rule that won the date. */
	replacedBy?: RuleRef;
	/** `replace` rules that occurred but lost to {@link replacedBy}. */
	outranked: RuleRef[];
	/** `subtract` rules that occurred. */
	removedBy: RemovalRef[];
	/** Call minutes cut away because they fall outside working hours (step 4). */
	clipped: Band[];
	/** Blackouts overlapping the date. */
	blackout?: { spans: BlackoutSpan[] };
}

/** What {@link validate} can report. */
export type IssueKind =
	| "call_outside_work"
	| "overlapping_bands"
	| "empty_next_30_days"
	| "rrule_invalid"
	| "replace_tie";

/** One finding about a preset. Errors block a save; warnings are shown. */
export interface Issue {
	kind: IssueKind;
	severity: "error" | "warning";
	ruleId: string | null;
	/** The other rule of a pair (`replace_tie`). */
	otherRuleId: string | null;
	layer: AvailabilityKind | null;
	/** The first date the issue shows on, when it is date-bound. */
	date: IsoDate | null;
	message: string;
}

/** {@link validate}'s inputs beyond the preset. */
export interface ValidateOptions {
	/** The owner's today; `empty_next_30_days` is only checked when it is given. */
	today?: IsoDate;
}
// #endregion

// #region Band algebra
/** Sort, merge overlapping or touching bands, and drop empty ones. */
export function unionBands(...lists: readonly (readonly Band[])[]): Band[] {
	const all = lists.flat().filter((b) => b.end > b.start).map((b) => ({
		start: b.start,
		end: b.end,
	}));
	all.sort((a, b) => a.start - b.start || a.end - b.end);
	const out: Band[] = [];
	for (const b of all) {
		const last = out[out.length - 1];
		if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
		else out.push(b);
	}
	return out;
}

/** `a` minus `b`, sorted and merged. */
export function subtractBands(a: readonly Band[], b: readonly Band[]): Band[] {
	const cut = unionBands(b);
	const out: Band[] = [];
	for (const band of unionBands(a)) {
		let start = band.start;
		for (const c of cut) {
			if (c.end <= start || c.start >= band.end) continue;
			if (c.start > start) out.push({ start, end: c.start });
			start = Math.max(start, c.end);
			if (start >= band.end) break;
		}
		if (start < band.end) out.push({ start, end: band.end });
	}
	return out;
}

/** The minutes in both `a` and `b`, sorted and merged. */
export function intersectBands(a: readonly Band[], b: readonly Band[]): Band[] {
	const x = unionBands(a);
	const y = unionBands(b);
	const out: Band[] = [];
	let i = 0;
	let j = 0;
	while (i < x.length && j < y.length) {
		const start = Math.max(x[i].start, y[j].start);
		const end = Math.min(x[i].end, y[j].end);
		if (end > start) out.push({ start, end });
		if (x[i].end < y[j].end) i++;
		else j++;
	}
	return out;
}
// #endregion

// #region Occurrence
const compiled = new WeakMap<AvailabilityRuleDraft, RRuleParts | null>();

function partsOf(rule: AvailabilityRuleDraft): RRuleParts | null {
	if (compiled.has(rule)) return compiled.get(rule) ?? null;
	const result = compileRecurrence(rule);
	const parts = result.ok ? result.value : null;
	compiled.set(rule, parts);
	return parts;
}

/**
 * Whether `rule`'s recurrence falls on `date` — recurrence only; `active` is the layer step's
 * concern. A rule whose recurrence does not compile never occurs (and {@link validate} says so).
 */
export function occursOn(rule: AvailabilityRuleDraft, date: IsoDate): boolean {
	const parts = partsOf(rule);
	return parts !== null &&
		expandRRule(parts, rule.startsOn, { from: date, to: date }, 1).length > 0;
}

type Occurs = (rule: AvailabilityRuleDraft, date: IsoDate) => boolean;

/** Expand every rule once over `range`, so a month of dates costs one expansion per rule. */
function occurrenceIndex(rules: readonly AvailabilityRuleDraft[], range: DateRange): Occurs {
	const index = new Map<AvailabilityRuleDraft, Set<IsoDate>>();
	for (const rule of rules) {
		const parts = partsOf(rule);
		index.set(
			rule,
			new Set(parts ? expandRRule(parts, rule.startsOn, range, Number.MAX_SAFE_INTEGER) : []),
		);
	}
	return (rule, date) => index.get(rule)?.has(date) ?? occursOn(rule, date);
}

function ref(rule: AvailabilityRuleDraft): RuleRef {
	return { ruleId: rule.id, label: rule.label, bands: unionBands(rule.bands) };
}

/** The winner of a set of `replace` rules: priority, then the latest `startsOn`, then the lowest id. */
function byReplacePrecedence(a: AvailabilityRuleDraft, b: AvailabilityRuleDraft): number {
	if (a.priority !== b.priority) return b.priority - a.priority;
	if (a.startsOn !== b.startsOn) return a.startsOn < b.startsOn ? 1 : -1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface LayerResolution {
	bands: Band[];
	/** Bands after steps 1–3, before the call clip. */
	unclipped: Band[];
	adds: AvailabilityRuleDraft[];
	winner: AvailabilityRuleDraft | null;
	outranked: AvailabilityRuleDraft[];
	removals: { rule: AvailabilityRuleDraft; removed: Band[] }[];
}

function resolveLayer(
	rules: readonly AvailabilityRuleDraft[],
	date: IsoDate,
	layer: AvailabilityKind,
	occurs: Occurs,
	working: readonly Band[] | null,
): LayerResolution {
	const live = rules.filter((r) => r.active && r.layer === layer && occurs(r, date));
	const adds = live.filter((r) => r.effect === "add");
	const replaces = live.filter((r) => r.effect === "replace").sort(byReplacePrecedence);
	const winner = replaces[0] ?? null;

	let base = winner ? unionBands(winner.bands) : unionBands(...adds.map((r) => r.bands));
	const removals: LayerResolution["removals"] = [];
	for (const rule of live.filter((r) => r.effect === "subtract")) {
		const cut = rule.bands.length ? unionBands(rule.bands) : [{ start: 0, end: 1440 }];
		removals.push({ rule, removed: intersectBands(base, cut) });
		base = subtractBands(base, cut);
	}
	const bands = working ? intersectBands(base, working) : base;
	return { bands, unclipped: base, adds, winner, outranked: replaces.slice(1), removals };
}

function contributorsOf(resolution: LayerResolution): AvailabilityRuleDraft[] {
	return resolution.winner ? [resolution.winner] : resolution.adds;
}

function resolveDay(preset: PresetLike, date: IsoDate, occurs: Occurs) {
	const working = resolveLayer(preset.rules, date, "working_hours", occurs, null);
	const call = resolveLayer(preset.rules, date, "call_window", occurs, working.bands);
	return { working, call };
}

/** The final local bands of one layer on one date (plan §5.2 steps 1–4). */
export function layerBandsFor(preset: PresetLike, date: IsoDate, layer: AvailabilityKind): Band[] {
	const day = resolveDay(preset, date, occursOn);
	return layer === "working_hours" ? day.working.bands : day.call.bands;
}
// #endregion

// #region Evaluate
function cutBlackouts(span: Occurrence, blackouts: readonly BlackoutSpan[]): Occurrence[] {
	let pieces: Occurrence[] = [span];
	for (const b of blackouts) {
		if (b.endsAt <= span.startsAt || b.startsAt >= span.endsAt) continue;
		pieces = pieces.flatMap((p) => {
			if (b.endsAt <= p.startsAt || b.startsAt >= p.endsAt) return [p];
			const out: Occurrence[] = [];
			if (b.startsAt > p.startsAt) out.push({ ...p, endsAt: b.startsAt });
			if (b.endsAt < p.endsAt) out.push({ ...p, startsAt: b.endsAt });
			return out;
		});
	}
	return pieces;
}

function joinSpans(spans: Occurrence[]): Occurrence[] {
	const out: Occurrence[] = [];
	for (const kind of ["working_hours", "call_window"] as const) {
		const ofKind = spans.filter((s) => s.kind === kind).sort((a, b) => a.startsAt - b.startsAt);
		let current: Occurrence | null = null;
		for (const s of ofKind) {
			if (current && s.startsAt <= current.endsAt) {
				current.endsAt = Math.max(current.endsAt, s.endsAt);
				current.ruleIds = [...new Set([...current.ruleIds, ...s.ruleIds])].sort();
			} else {
				current = { ...s, ruleIds: [...s.ruleIds] };
				out.push(current);
			}
		}
	}
	return out.sort((a, b) => a.startsAt - b.startsAt || (a.kind < b.kind ? -1 : 1));
}

/**
 * The absolute availability of `preset` over the local dates of `range` (inclusive), both layers,
 * blackouts removed (plan §5.2 steps 1–6). Each span lists the rules that produced it — the `add`
 * rules of its day, or the `replace` rule that won it.
 */
export function evaluate(
	preset: PresetLike,
	range: DateRange,
	blackouts: readonly BlackoutSpan[] = [],
): Occurrence[] {
	const occurs = occurrenceIndex(preset.rules, range);
	const spans: Occurrence[] = [];
	for (const date of eachDate(range.from, range.to)) {
		const day = resolveDay(preset, date, occurs);
		for (
			const [kind, resolution] of [["working_hours", day.working], [
				"call_window",
				day.call,
			]] as const
		) {
			const ruleIds = contributorsOf(resolution).map((r) => r.id).sort();
			for (const band of resolution.bands) {
				const { startsAt, endsAt } = zonedSpan(date, band.start, band.end, preset.timezone);
				if (endsAt > startsAt) {
					spans.push(...cutBlackouts({ kind, startsAt, endsAt, ruleIds }, blackouts));
				}
			}
		}
	}
	return joinSpans(spans);
}
// #endregion

// #region Explain
/** Why `date` looks the way it does, one entry per layer (working hours first). */
export function explain(
	preset: PresetLike,
	date: IsoDate,
	blackouts: readonly BlackoutSpan[] = [],
): LayerExplanation[] {
	const day = resolveDay(preset, date, occursOn);
	const dayStart = zonedSpan(date, 0, 0, preset.timezone).startsAt;
	const dayEnd = zonedSpan(date, 1440, 1440, preset.timezone).startsAt;
	const hits = blackouts.filter((b) => b.startsAt < dayEnd && b.endsAt > dayStart);

	return ([["working_hours", day.working], ["call_window", day.call]] as const).map(
		([layer, r]) => {
			const out: LayerExplanation = {
				layer,
				bands: r.bands,
				contributed: r.adds.map(ref),
				outranked: r.outranked.map(ref),
				removedBy: r.removals.map(({ rule, removed }) => ({ ...ref(rule), removed })),
				clipped: subtractBands(r.unclipped, r.bands),
			};
			if (r.winner) out.replacedBy = ref(r.winner);
			if (hits.length) out.blackout = { spans: hits };
			return out;
		},
	);
}
// #endregion

// #region Validate
const VALIDATE_HORIZON_DAYS = 366;

function issue(
	kind: IssueKind,
	severity: Issue["severity"],
	message: string,
	extra: Partial<Issue> = {},
): Issue {
	return {
		kind,
		severity,
		ruleId: null,
		otherRuleId: null,
		layer: null,
		date: null,
		message,
		...extra,
	};
}

function earliestStart(rules: readonly AvailabilityRuleDraft[]): IsoDate | null {
	let min: IsoDate | null = null;
	for (const r of rules) if (min === null || r.startsOn < min) min = r.startsOn;
	return min;
}

/**
 * Everything worth telling the author about `preset`:
 * - `rrule_invalid` (error) — a recurrence that does not compile, or whose RRULE does not re-parse;
 * - `overlapping_bands` (error) — two bands of one rule overlap;
 * - `call_outside_work` (warning) — a call band falls outside working hours (it is clipped, never
 *   widened), reported once per rule at its first date;
 * - `replace_tie` (warning) — two `replace` rules of one layer and priority fall on the same date;
 * - `empty_next_30_days` (warning, per layer) — nothing in the 30 days from `options.today`.
 *
 * Date-bound checks look a year ahead of `options.today`, or of the earliest rule start without it.
 */
export function validate(preset: PresetLike, options: ValidateOptions = {}): Issue[] {
	const issues: Issue[] = [];
	const active = preset.rules.filter((r) => r.active);

	for (const rule of active) {
		const result = compileRecurrence(rule);
		if (!result.ok) {
			issues.push(
				issue("rrule_invalid", "error", RECURRENCE_REFUSAL_COPY[result.reason], {
					ruleId: rule.id,
				}),
			);
			continue;
		}
		const reparsed = parseRRule(serialiseRRule(result.value));
		if (!reparsed.ok) {
			issues.push(
				issue("rrule_invalid", "error", RRULE_REFUSAL_COPY[reparsed.reason], { ruleId: rule.id }),
			);
		}
		const bands = [...rule.bands].sort((a, b) => a.start - b.start);
		for (let i = 1; i < bands.length; i++) {
			if (bands[i].start < bands[i - 1].end) {
				issues.push(
					issue("overlapping_bands", "error", "Two times in this rule overlap.", {
						ruleId: rule.id,
						layer: rule.layer,
					}),
				);
				break;
			}
		}
	}

	const start = options.today ?? earliestStart(active);
	if (start === null) return issues;
	const horizon: DateRange = { from: start, to: addDays(start, VALIDATE_HORIZON_DAYS - 1) };
	const occurs = occurrenceIndex(active, horizon);

	const outside = new Map<string, IsoDate>();
	for (const date of eachDate(horizon.from, horizon.to)) {
		const day = resolveDay(preset, date, occurs);
		const beyond = subtractBands(day.call.unclipped, day.working.bands);
		if (!beyond.length) continue;
		for (const rule of contributorsOf(day.call)) {
			if (!outside.has(rule.id) && intersectBands(rule.bands, beyond).length) {
				outside.set(rule.id, date);
			}
		}
	}
	for (const [ruleId, date] of outside) {
		issues.push(
			issue(
				"call_outside_work",
				"warning",
				"Some call times fall outside working hours, so they are not offered.",
				{
					ruleId,
					layer: "call_window",
					date,
				},
			),
		);
	}

	const replaces = active.filter((r) => r.effect === "replace");
	for (let i = 0; i < replaces.length; i++) {
		for (let j = i + 1; j < replaces.length; j++) {
			const [a, b] = [replaces[i], replaces[j]];
			if (a.layer !== b.layer || a.priority !== b.priority) continue;
			const shared = eachDate(horizon.from, horizon.to).find((d) => occurs(a, d) && occurs(b, d));
			if (!shared) continue;
			const winner = [a, b].sort(byReplacePrecedence)[0];
			issues.push(
				issue(
					"replace_tie",
					"warning",
					`Two overrides with the same priority fall on the same day; “${
						winner.label || winner.id
					}” wins.`,
					{ ruleId: a.id, otherRuleId: b.id, layer: a.layer, date: shared },
				),
			);
		}
	}

	if (options.today) {
		const next30: DateRange = { from: options.today, to: addDays(options.today, 29) };
		const spans = evaluate({ timezone: preset.timezone, rules: active }, next30);
		for (const layer of ["working_hours", "call_window"] as const) {
			if (spans.some((s) => s.kind === layer)) continue;
			const what = layer === "working_hours" ? "working hours" : "call windows";
			issues.push(
				issue("empty_next_30_days", "warning", `No ${what} in the next 30 days.`, {
					layer,
					date: options.today,
				}),
			);
		}
	}
	return issues;
}
// #endregion
