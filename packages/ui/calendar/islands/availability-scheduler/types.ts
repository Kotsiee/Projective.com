/**
 * @projective/ui/calendar — AvailabilityScheduler contract (plan §5.4). Plain TypeScript, no Zod:
 * `packages/ui` never imports `@projective/types`, so these are STRUCTURAL mirrors of the scheduling
 * shapes and the engine is injected, exactly like the Gantt adapter. A host passes an object built
 * from `@projective/types/scheduling` that satisfies {@link SchedulerEngine}.
 *
 * Dates are civil `YYYY-MM-DD` strings; band times are minutes from local midnight; occurrences are
 * epoch milliseconds (UTC).
 */

// #region Vocabulary
/** How a rule combines with the day it falls on. */
export type RuleEffect = "add" | "replace" | "subtract";

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Grid snap in minutes. */
export type Snap = 5 | 15 | 30;

/** Which main view the scheduler shows. */
export type SchedulerView = "week" | "month";

/** One band, minutes from local midnight, `end > start`; never crosses midnight. */
export interface Band {
	start: number;
	end: number;
}
// #endregion

// #region Rules
/** The human-shaped recurrence the editor authors. */
export type RulePattern =
	| { type: "daily"; interval: number }
	| { type: "weekly"; days: number[]; interval: number }
	| { type: "monthly_date"; days: number[]; interval: number }
	| { type: "monthly_weekday"; ordinal: number; weekday: number; interval: number }
	| { type: "yearly"; month: number; day: number; interval: number }
	| { type: "once"; date: string };

/** The pattern discriminant. */
export type RulePatternType = RulePattern["type"];

/** "Unless it is …" weekdays, compiled to the BYDAY complement. */
export interface RuleCondition {
	unlessWeekdays: number[];
}

/** A rule's own price for a paid call: minor units in an ISO currency. */
export interface RuleFee {
	amountMinor: number;
	currency: string;
}

/** One authored rule. Every rule is working hours: availability is one layer (Decision #408). */
export interface RuleDraft {
	id: string;
	effect: RuleEffect;
	pattern: RulePattern;
	condition: RuleCondition;
	bands: Band[];
	startsOn: string;
	endsOn: string | null;
	priority: number;
	label: string;
	active: boolean;
	/** A paid call's price inside the rule's bands; `null` inherits the host's fee. */
	fee: RuleFee | null;
	/** The swatch the rule is drawn in, a `--swatch-*` token name; `null` is the default fill. */
	colorToken: string | null;
}

/** A named rule set — the scheduler's value. */
export interface Preset {
	id: string;
	name: string;
	description: string;
	timezone: string;
	isDefault: boolean;
	scope: "library" | "service";
	blueprintId: string | null;
	rules: RuleDraft[];
	archivedAt: string | null;
}

/** A starting point the preset bar can load; its rules are copied with fresh ids. */
export interface SchedulerTemplate {
	key: string;
	name: string;
	description: string;
	rules: readonly RuleDraft[];
}
// #endregion

// #region Engine results
/** An inclusive civil date range. */
export interface DateRange {
	from: string;
	to: string;
}

/** An evaluated span on the timeline: working hours, with the rules that drew it. */
export interface Occurrence {
	kind: "working_hours";
	startsAt: number;
	endsAt: number;
	ruleIds: string[];
}

/** A rule as an explanation names it. */
export interface RuleRef {
	ruleId: string;
	label: string;
	bands: Band[];
}

/** A subtract rule that occurred, and what it took away. */
export interface RemovalRef extends RuleRef {
	removed: Band[];
}

/** An absolute blackout overlapping a date. */
export interface BlackoutSpan {
	startsAt: number;
	endsAt: number;
	label?: string;
	labelIsPublic?: boolean;
}

/** Why one date looks the way it does. */
export interface DayExplanation {
	bands: Band[];
	contributed: RuleRef[];
	replacedBy?: RuleRef;
	outranked: RuleRef[];
	removedBy: RemovalRef[];
	blackout?: { spans: BlackoutSpan[] };
}

/** The engine's account of one date. */
export type Explanation = DayExplanation;

/** One finding about a preset. Errors block a save; warnings are shown. */
export interface Issue {
	kind: string;
	severity: "error" | "warning";
	ruleId: string | null;
	otherRuleId: string | null;
	date: string | null;
	message: string;
}

/** The recurrence a raw RRULE describes, or why it was refused. */
export type RRuleReading =
	| { ok: true; pattern: RulePattern; condition: RuleCondition; endsOn: string | null }
	| { ok: false; message: string };

/** A rule's canonical RRULE, or why it cannot compile. */
export type RRuleWriting = { ok: true; rrule: string } | { ok: false; message: string };
// #endregion

// #region Engine
/**
 * The scheduling engine the host injects. Every method is pure; the scheduler calls them inside
 * computeds, so they must not touch the clock or the network.
 */
export interface SchedulerEngine {
	/** Absolute availability over the local dates of `range`. */
	evaluate(preset: Preset, range: DateRange): Occurrence[];
	/** Why `date` looks the way it does. */
	explain(preset: Preset, date: string): Explanation;
	/** One rule as a sentence ("Every other Wednesday from 6 Oct · 06:00–12:00 · working hours"). */
	describe(rule: RuleDraft): string;
	/** Everything worth telling the author; `today` enables the next-30-days check. */
	validate(preset: Preset, options?: { today?: string }): Issue[];
	/** Read a pasted RRULE anchored at `startsOn`. */
	parseRRule(rrule: string, startsOn: string): RRuleReading;
	/** Compile a rule's recurrence to its canonical RRULE. */
	draftToRRule(rule: RuleDraft): RRuleWriting;
}

/** A blackout date the month preview marks. */
export interface SchedulerBlackout {
	date: string;
	label?: string;
	labelIsPublic?: boolean;
}

/**
 * What the rule editor's price field needs (Decision #408): the currency a rule is priced in and the
 * fee a rule without its own inherits. A host passes it only while paid calls are live; without it
 * the field is not drawn.
 */
export interface SchedulerPricing {
	currency: string;
	inherited: RuleFee | null;
}

/** The binding line under the preset bar (plan §5.5). Each action renders only when supplied. */
export interface PresetBinding {
	/** `linked` = uses a library preset; `forked` = custom for this service. */
	mode: "linked" | "forked";
	/** The library preset the service uses, or reverts to. */
	presetName: string;
	onEditPreset?: () => void;
	onOverride?: () => void;
	onRevert?: () => void;
	onSaveAsPreset?: () => void;
}
// #endregion
