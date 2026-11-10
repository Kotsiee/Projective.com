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

/**
 * scheduling.evaluate — THE availability evaluator (Decision #217 (d)): one pure implementation
 * the editor preview, the occurrence compiler and the booking gate's compiled spans all share.
 *
 * Availability is one layer (Decision #408): every rule is working hours, and a discovery call is
 * booked inside them. Per local date D, in the preset's zone (plan §5.2):
 *  1. base = the union of every active `add` rule occurring on D;
 *  2. an active `replace` rule on D replaces base — highest priority, then the most recent
 *     `startsOn`, then the lowest id;
 *  3. every active `subtract` rule on D removes its bands; one with no bands removes the day;
 *  4. bands become absolute spans (DST gap → the gap's end; overlap → the first occurrence);
 *  5. blackouts (absolute) are cut out, and spans touching across midnight are joined.
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

/** Why one date looks the way it does. */
export interface DayExplanation {
	/** The final local bands, after steps 1–3. */
	bands: Band[];
	/** `add` rules that occurred on the date (discarded when {@link replacedBy} is set). */
	contributed: RuleRef[];
	/** The `replace` rule that won the date. */
	replacedBy?: RuleRef;
	/** `replace` rules that occurred but lost to {@link replacedBy}. */
	outranked: RuleRef[];
	/** `subtract` rules that occurred. */
	removedBy: RemovalRef[];
	/** Blackouts overlapping the date. */
	blackout?: { spans: BlackoutSpan[] };
}

/** What {@link validate} can report. */
export type IssueKind =
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
 * Whether `rule`'s recurrence falls on `date` — recurrence only; `active` is the day step's
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

interface DayResolution {
	bands: Band[];
	adds: AvailabilityRuleDraft[];
	winner: AvailabilityRuleDraft | null;
	outranked: AvailabilityRuleDraft[];
	removals: { rule: AvailabilityRuleDraft; removed: Band[] }[];
}

function resolveDay(preset: PresetLike, date: IsoDate, occurs: Occurs): DayResolution {
	const live = preset.rules.filter((r) => r.active && occurs(r, date));
	const adds = live.filter((r) => r.effect === "add");
	const replaces = live.filter((r) => r.effect === "replace").sort(byReplacePrecedence);
	const winner = replaces[0] ?? null;

	let bands = winner ? unionBands(winner.bands) : unionBands(...adds.map((r) => r.bands));
	const removals: DayResolution["removals"] = [];
	for (const rule of live.filter((r) => r.effect === "subtract")) {
		const cut = rule.bands.length ? unionBands(rule.bands) : [{ start: 0, end: 1440 }];
		removals.push({ rule, removed: intersectBands(bands, cut) });
		bands = subtractBands(bands, cut);
	}
	return { bands, adds, winner, outranked: replaces.slice(1), removals };
}

/**
 * The rules that drew one final band: the day's `replace` winner, or the `add` rules whose own bands
 * reach into it — so two rules that share a day but not their hours each keep their own spans.
 */
function contributorsOf(resolution: DayResolution, band: Band): AvailabilityRuleDraft[] {
	if (resolution.winner) return [resolution.winner];
	return resolution.adds.filter((rule) => intersectBands(rule.bands, [band]).length > 0);
}

/** The final local bands of one date (plan §5.2 steps 1–3). */
export function dayBandsFor(preset: PresetLike, date: IsoDate): Band[] {
	return resolveDay(preset, date, occursOn).bands;
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
	let current: Occurrence | null = null;
	for (const s of [...spans].sort((a, b) => a.startsAt - b.startsAt)) {
		if (current && s.startsAt <= current.endsAt) {
			current.endsAt = Math.max(current.endsAt, s.endsAt);
			current.ruleIds = [...new Set([...current.ruleIds, ...s.ruleIds])].sort();
		} else {
			current = { ...s, ruleIds: [...s.ruleIds] };
			out.push(current);
		}
	}
	return out;
}

/**
 * The absolute availability of `preset` over the local dates of `range` (inclusive), blackouts
 * removed (plan §5.2 steps 1–5). Each span lists the rules that drew it — the `add` rules whose bands
 * reach into it, or the `replace` rule that won its day; spans that touch are joined, and so are
 * their rules.
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
		for (const band of day.bands) {
			const { startsAt, endsAt } = zonedSpan(date, band.start, band.end, preset.timezone);
			if (endsAt <= startsAt) continue;
			const ruleIds = contributorsOf(day, band).map((r) => r.id).sort();
			spans.push(
				...cutBlackouts({ kind: "working_hours", startsAt, endsAt, ruleIds }, blackouts),
			);
		}
	}
	return joinSpans(spans);
}
// #endregion

// #region Explain
/** Why `date` looks the way it does. */
export function explain(
	preset: PresetLike,
	date: IsoDate,
	blackouts: readonly BlackoutSpan[] = [],
): DayExplanation {
	const day = resolveDay(preset, date, occursOn);
	const dayStart = zonedSpan(date, 0, 0, preset.timezone).startsAt;
	const dayEnd = zonedSpan(date, 1440, 1440, preset.timezone).startsAt;
	const hits = blackouts.filter((b) => b.startsAt < dayEnd && b.endsAt > dayStart);

	const out: DayExplanation = {
		bands: day.bands,
		contributed: day.adds.map(ref),
		outranked: day.outranked.map(ref),
		removedBy: day.removals.map(({ rule, removed }) => ({ ...ref(rule), removed })),
	};
	if (day.winner) out.replacedBy = ref(day.winner);
	if (hits.length) out.blackout = { spans: hits };
	return out;
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
 * - `replace_tie` (warning) — two `replace` rules of one priority fall on the same date;
 * - `empty_next_30_days` (warning) — no working hours in the 30 days from `options.today`.
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

	const replaces = active.filter((r) => r.effect === "replace");
	for (let i = 0; i < replaces.length; i++) {
		for (let j = i + 1; j < replaces.length; j++) {
			const [a, b] = [replaces[i], replaces[j]];
			if (a.priority !== b.priority) continue;
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
					{ ruleId: a.id, otherRuleId: b.id, date: shared },
				),
			);
		}
	}

	if (options.today) {
		const next30: DateRange = { from: options.today, to: addDays(options.today, 29) };
		const spans = evaluate({ timezone: preset.timezone, rules: active }, next30);
		if (!spans.length) {
			issues.push(
				issue("empty_next_30_days", "warning", "No working hours in the next 30 days.", {
					date: options.today,
				}),
			);
		}
	}
	return issues;
}
// #endregion
