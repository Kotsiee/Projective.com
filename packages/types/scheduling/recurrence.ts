import { z } from "zod";
import { civilParts, daysInMonth, IsoDate, weekdayOf } from "./civil.ts";
import { parseRRule, type RRuleParts, serialiseRRule } from "./rrule.ts";
import { AvailabilityKind, ianaTimezone, PresetScope, RuleEffect } from "./rows.ts";

/**
 * scheduling.recurrence — the AUTHORING shape of an availability rule (plan §5.2) and its exact,
 * two-way compilation to an RFC 5545 `RRULE` (plan §5.3).
 *
 * The editor authors a human pattern ("monthly on the 12th, unless it's a Thursday or Friday"); the
 * database stores the `RRULE` plus `startsOn`. Every pattern compiles to PURE RFC 5545 — a condition
 * RRULE cannot express is refused here with a reason, never approximated — and
 * `rruleToDraft(draftToRRule(d), d.startsOn)` returns `d`'s recurrence unchanged.
 */

// #region Vocabulary
/** 0 = Sunday … 6 = Saturday, the `Date#getDay` / `availability_rules.weekday` convention. */
export const Weekday = z.number().int().min(0).max(6);
export type Weekday = z.infer<typeof Weekday>;

/** One band in minutes from local midnight; never crosses midnight (#56) — the editor splits. */
export const BandSchema = z.object({
	start: z.number().int().min(0).max(1439),
	end: z.number().int().min(1).max(1440),
}).refine((b) => b.end > b.start, "A band must end after it starts.");
export type Band = z.infer<typeof BandSchema>;

const uniqueNumbers = (values: readonly number[]) => new Set(values).size === values.length;
const monthDay = z.number().int().min(-31).max(31).refine((d) => d !== 0, "Day 0 does not exist.");

/** The human-shaped pattern the editor authors; normalised to an RRULE for storage. */
export const RulePatternSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("weekly"),
		days: z.array(Weekday).min(1).max(7).refine(uniqueNumbers, "A weekday is listed twice."),
		interval: z.number().int().min(1).max(8),
	}),
	z.object({
		type: z.literal("monthly_date"),
		days: z.array(monthDay).min(1).max(31).refine(uniqueNumbers, "A day is listed twice."),
		interval: z.number().int().min(1).max(12),
	}),
	z.object({
		type: z.literal("monthly_weekday"),
		ordinal: z.union([z.literal(-1), z.number().int().min(1).max(4)]),
		weekday: Weekday,
		interval: z.number().int().min(1).max(12),
	}),
	z.object({
		type: z.literal("yearly"),
		month: z.number().int().min(1).max(12),
		day: z.number().int().min(1).max(31),
	}).refine((p) => p.day <= daysInMonth(2000, p.month), "That month has no such day."),
	z.object({ type: z.literal("once"), date: IsoDate }),
]);
export type RulePattern = z.infer<typeof RulePatternSchema>;

/** "Unless it is Thursday or Friday" — compiled into BYDAY of the complement. */
export const RuleConditionSchema = z.object({
	unlessWeekdays: z.array(Weekday).max(6).refine(uniqueNumbers, "A weekday is listed twice.")
		.default([]),
});
export type RuleCondition = z.infer<typeof RuleConditionSchema>;
// #endregion

// #region Refusals
/** Why a pattern + condition cannot compile to an RRULE. */
export type RecurrenceRefusal =
	| "condition_on_weekly"
	| "condition_on_monthly_weekday"
	| "condition_on_once"
	| "once_starts_elsewhere"
	| "once_has_end"
	| "ends_before_start";

/** The refusal copy, one sentence each, shown under the rule editor. */
export const RECURRENCE_REFUSAL_COPY: Record<RecurrenceRefusal, string> = {
	condition_on_weekly:
		"A weekly rule already picks its days — choose the days instead of an exception.",
	condition_on_monthly_weekday:
		"This rule already falls on one weekday, so an exception by weekday changes nothing.",
	condition_on_once: "A single date cannot have a weekday exception.",
	once_starts_elsewhere: "A one-off rule must start on its own date.",
	once_has_end: "A one-off rule ends on its own date; remove the end date.",
	ends_before_start: "The end date is before the start date.",
};

/** The recurrence-bearing slice of a rule draft. */
export interface RecurrenceInput {
	pattern: RulePattern;
	condition: RuleCondition;
	startsOn: IsoDate;
	endsOn: IsoDate | null;
}

/** Why `input` cannot compile, or `null` when it can. */
export function recurrenceRefusal(input: RecurrenceInput): RecurrenceRefusal | null {
	const { pattern, condition, startsOn, endsOn } = input;
	if (endsOn !== null && endsOn < startsOn) return "ends_before_start";
	const conditioned = condition.unlessWeekdays.length > 0;
	if (pattern.type === "weekly" && conditioned) return "condition_on_weekly";
	if (pattern.type === "monthly_weekday" && conditioned) return "condition_on_monthly_weekday";
	if (pattern.type === "once") {
		if (conditioned) return "condition_on_once";
		if (pattern.date !== startsOn) return "once_starts_elsewhere";
		if (endsOn !== null) return "once_has_end";
	}
	return null;
}

/** A draft that reached {@link draftToRRule} without passing {@link AvailabilityRuleDraftSchema}. */
export class RecurrenceError extends Error {
	/** The machine-readable cause. */
	readonly code: RecurrenceRefusal;

	constructor(code: RecurrenceRefusal) {
		super(RECURRENCE_REFUSAL_COPY[code]);
		this.name = "RecurrenceError";
		this.code = code;
	}
}
// #endregion

// #region Draft
/** One authored rule. */
export const AvailabilityRuleDraftSchema = z.object({
	/** Client id until saved; uuid after. */
	id: z.string().min(1).max(40),
	layer: AvailabilityKind,
	effect: RuleEffect,
	pattern: RulePatternSchema,
	condition: RuleConditionSchema.default({ unlessWeekdays: [] }),
	/** Empty + `subtract` = the whole day off. */
	bands: z.array(BandSchema).max(6),
	/** The DTSTART anchor — it fixes bi-weekly parity. */
	startsOn: IsoDate,
	/** UNTIL, inclusive. */
	endsOn: IsoDate.nullable(),
	priority: z.number().int().min(0).max(99).default(50),
	label: z.string().max(80).default(""),
	active: z.boolean().default(true),
}).superRefine((draft, ctx) => {
	const refusal = recurrenceRefusal(draft);
	if (refusal) {
		ctx.addIssue({
			code: "custom",
			message: RECURRENCE_REFUSAL_COPY[refusal],
			path: ["condition"],
		});
	}
});
export type AvailabilityRuleDraft = z.infer<typeof AvailabilityRuleDraftSchema>;

/** A named rule set under the owner's schedule (Decision #217 (c)). */
export const AvailabilityPresetSchema = z.object({
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(60),
	description: z.string().max(200),
	timezone: ianaTimezone,
	isDefault: z.boolean(),
	scope: PresetScope,
	/** Set only for a service-scoped fork. */
	blueprintId: z.string().max(64).nullable(),
	rules: z.array(AvailabilityRuleDraftSchema).max(64),
	archivedAt: z.string().nullable(),
}).refine((p) => (p.scope === "service") === (p.blueprintId !== null), {
	message: "A service preset belongs to exactly one service; a library preset to none.",
	path: ["blueprintId"],
}).refine((p) => new Set(p.rules.map((r) => r.id)).size === p.rules.length, {
	message: "Two rules share an id.",
	path: ["rules"],
});
export type AvailabilityPreset = z.infer<typeof AvailabilityPresetSchema>;
// #endregion

// #region Compile
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function complement(days: readonly number[]): number[] {
	return ALL_WEEKDAYS.filter((d) => !days.includes(d));
}

function sorted(values: readonly number[]): number[] {
	return [...values].sort((a, b) => a - b);
}

/** The compiled parts of a recurrence, or the reason it cannot compile. */
export type RecurrenceCompile =
	| { ok: true; value: RRuleParts }
	| { ok: false; reason: RecurrenceRefusal; message: string };

/** Compile a recurrence to canonical {@link RRuleParts} without throwing. */
export function compileRecurrence(input: RecurrenceInput): RecurrenceCompile {
	const refusal = recurrenceRefusal(input);
	if (refusal) return { ok: false, reason: refusal, message: RECURRENCE_REFUSAL_COPY[refusal] };
	const { pattern, condition, endsOn } = input;
	const unless = condition.unlessWeekdays.length
		? complement(condition.unlessWeekdays).map((wd) => ({ wd }))
		: [];
	const base = { interval: 1, byDay: [], byMonthDay: [], byMonth: [], bySetPos: [], wkst: 1 };
	let value: RRuleParts;
	switch (pattern.type) {
		case "weekly":
			value = {
				...base,
				freq: "WEEKLY",
				interval: pattern.interval,
				byDay: sorted(pattern.days).map((wd) => ({ wd })),
			};
			break;
		case "monthly_date":
			value = {
				...base,
				freq: "MONTHLY",
				interval: pattern.interval,
				byMonthDay: sorted(pattern.days),
				byDay: unless,
			};
			break;
		case "monthly_weekday":
			value = {
				...base,
				freq: "MONTHLY",
				interval: pattern.interval,
				byDay: [{ wd: pattern.weekday, ordinal: pattern.ordinal }],
			};
			break;
		case "yearly":
			value = {
				...base,
				freq: "YEARLY",
				byMonth: [pattern.month],
				byMonthDay: [pattern.day],
				byDay: unless,
			};
			break;
		case "once":
			return { ok: true, value: { ...base, freq: "DAILY", until: pattern.date } };
	}
	if (endsOn !== null) value.until = endsOn;
	return { ok: true, value };
}

/**
 * The canonical RRULE string of a rule. `unlessWeekdays` compiles to the BYDAY complement; a `once`
 * rule is `FREQ=DAILY;UNTIL=<its date>` anchored on that date.
 *
 * Throws {@link RecurrenceError} for a refused recurrence — schema-valid drafts never are.
 */
export function draftToRRule(input: RecurrenceInput): string {
	const compiled = compileRecurrence(input);
	if (!compiled.ok) throw new RecurrenceError(compiled.reason);
	return serialiseRRule(compiled.value);
}

/** The recurrence a stored RRULE describes, in draft terms. */
export interface RecurrenceDraft {
	pattern: RulePattern;
	condition: RuleCondition;
	endsOn: IsoDate | null;
}

const MONTHLY_ORDINALS = [-1, 1, 2, 3, 4];

/**
 * Read a stored RRULE (anchored at `startsOn`) back into draft terms, or `null` when the rule is
 * valid RFC 5545 but no draft pattern expresses it — the editor's Advanced field then keeps the raw
 * rule. Equivalent spellings normalise: `FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1` reads as "last Friday".
 */
export function rruleToDraft(rrule: string, startsOn: IsoDate): RecurrenceDraft | null {
	const parsed = parseRRule(rrule);
	if (!parsed.ok) return null;
	const p = parsed.value;
	const endsOn = p.until ?? null;
	if (endsOn !== null && endsOn < startsOn) return null;
	const anchor = civilParts(startsOn);
	const plainDays = p.byDay.every((d) => d.ordinal === undefined);
	const noCondition: RuleCondition = { unlessWeekdays: [] };
	const conditionOf = (): RuleCondition => ({
		unlessWeekdays: p.byDay.length ? complement(p.byDay.map((d) => d.wd)) : [],
	});

	switch (p.freq) {
		case "DAILY": {
			if (p.interval !== 1 || p.byMonth.length || p.byMonthDay.length || p.bySetPos.length) {
				return null;
			}
			if (endsOn === startsOn && !p.byDay.length) {
				return { pattern: { type: "once", date: startsOn }, condition: noCondition, endsOn: null };
			}
			const days = p.byDay.length ? p.byDay.map((d) => d.wd) : ALL_WEEKDAYS;
			return { pattern: { type: "weekly", days, interval: 1 }, condition: noCondition, endsOn };
		}
		case "WEEKLY": {
			if (p.byMonth.length || p.bySetPos.length || p.interval > 8) return null;
			if (p.interval > 1 && p.wkst !== 1) return null;
			const days = p.byDay.length ? p.byDay.map((d) => d.wd) : [weekdayOf(startsOn)];
			return {
				pattern: { type: "weekly", days, interval: p.interval },
				condition: noCondition,
				endsOn,
			};
		}
		case "MONTHLY": {
			if (p.byMonth.length || p.interval > 12) return null;
			if (p.bySetPos.length) {
				const [pos] = p.bySetPos;
				if (p.bySetPos.length !== 1 || !MONTHLY_ORDINALS.includes(pos)) return null;
				if (p.byMonthDay.length || p.byDay.length !== 1 || !plainDays) return null;
				return {
					pattern: {
						type: "monthly_weekday",
						ordinal: pos,
						weekday: p.byDay[0].wd,
						interval: p.interval,
					},
					condition: noCondition,
					endsOn,
				};
			}
			if (p.byMonthDay.length) {
				if (!plainDays) return null;
				return {
					pattern: { type: "monthly_date", days: p.byMonthDay, interval: p.interval },
					condition: conditionOf(),
					endsOn,
				};
			}
			if (p.byDay.length) {
				const [entry] = p.byDay;
				if (
					p.byDay.length !== 1 || entry.ordinal === undefined ||
					!MONTHLY_ORDINALS.includes(entry.ordinal)
				) {
					return null;
				}
				return {
					pattern: {
						type: "monthly_weekday",
						ordinal: entry.ordinal,
						weekday: entry.wd,
						interval: p.interval,
					},
					condition: noCondition,
					endsOn,
				};
			}
			return {
				pattern: { type: "monthly_date", days: [anchor.day], interval: p.interval },
				condition: noCondition,
				endsOn,
			};
		}
		case "YEARLY": {
			if (
				p.interval !== 1 || p.bySetPos.length || p.byMonth.length > 1 || p.byMonthDay.length > 1
			) return null;
			if (!plainDays) return null;
			if (!p.byMonth.length && (p.byMonthDay.length || p.byDay.length)) return null;
			if (!p.byMonthDay.length && p.byDay.length) return null;
			const month = p.byMonth[0] ?? anchor.month;
			const day = p.byMonthDay[0] ?? anchor.day;
			if (day < 1 || day > daysInMonth(2000, month)) return null;
			return { pattern: { type: "yearly", month, day }, condition: conditionOf(), endsOn };
		}
	}
}
// #endregion
