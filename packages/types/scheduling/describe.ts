import { civilParts, type IsoDate } from "./civil.ts";
import type { PresetLike } from "./evaluate.ts";
import type { AvailabilityRuleDraft, Band, RulePattern } from "./recurrence.ts";

/**
 * scheduling.describe — the sentence form of a rule, for the rule list and the editor's live
 * preview (plan §5.3): "Every other Wednesday from 6 Oct · 06:00–12:00, 14:00–19:00 · working hours".
 *
 * Weekday names, month names, dates, times and lists come from `Intl` in the requested locale; the
 * connecting phrases are this product's English copy.
 */

// #region Intl
const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}|${JSON.stringify(options)}`;
	let fmt = formatters.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
		formatters.set(key, fmt);
	}
	return fmt;
}

/** A known date of each weekday (0 = Sunday), for formatting names. 2000-01-02 was a Sunday. */
function weekdayInstant(wd: number): Date {
	return new Date(Date.UTC(2000, 0, 2 + wd));
}

function weekdayName(wd: number, locale: string): string {
	return dateFormat(locale, { weekday: "long" }).format(weekdayInstant(wd));
}

function list(
	items: string[],
	locale: string,
	type: "conjunction" | "disjunction" = "conjunction",
): string {
	return new Intl.ListFormat(locale, { style: "long", type }).format(items);
}

const ORDINAL_SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };

function ordinal(n: number): string {
	return `${n}${
		ORDINAL_SUFFIX[new Intl.PluralRules("en-GB", { type: "ordinal" }).select(n)] ?? "th"
	}`;
}

function time(minute: number, locale: string): string {
	return dateFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
		.format(new Date(Date.UTC(2000, 0, 1, 0, minute % 1440)));
}

function shortDate(date: IsoDate, locale: string, withYear: boolean): string {
	const p = civilParts(date);
	const options: Intl.DateTimeFormatOptions = withYear
		? { day: "numeric", month: "short", year: "numeric" }
		: { day: "numeric", month: "short" };
	return dateFormat(locale, options).format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
}
// #endregion

// #region Pattern
function monthDayPhrase(day: number): string {
	if (day === -1) return "last day";
	if (day < 0) return `${ordinal(-day)}-to-last day`;
	return ordinal(day);
}

function everyPhrase(interval: number, unit: "week" | "month"): string {
	if (interval === 1) return unit === "week" ? "Every" : "Monthly";
	if (interval === 2) return unit === "week" ? "Every other" : "Every other month";
	return `Every ${interval} ${unit}s`;
}

function exceptionPhrase(unless: readonly number[], locale: string): string {
	if (!unless.length) return "";
	const days = [...unless].sort((a, b) => a - b).map((wd) => weekdayName(wd, locale));
	return `, unless it's a ${list(days, locale, "disjunction")}`;
}

function patternPhrase(pattern: RulePattern, locale: string): string {
	switch (pattern.type) {
		case "weekly": {
			const days = [...pattern.days].sort((a, b) => a - b);
			const named = days.length === 7
				? "day"
				: days.length === 5 && days.every((d) => d >= 1 && d <= 5)
				? "weekday"
				: list(days.map((d) => weekdayName(d, locale)), locale);
			if (pattern.interval === 1) return `Every ${named}`;
			if (pattern.interval === 2) return `Every other ${named}`;
			return `Every ${pattern.interval} weeks on ${named}`;
		}
		case "monthly_date": {
			const days = [...pattern.days].sort((a, b) => (a < 0 ? 100 - a : a) - (b < 0 ? 100 - b : b));
			return `${everyPhrase(pattern.interval, "month")} on the ${
				list(days.map(monthDayPhrase), locale)
			}`;
		}
		case "monthly_weekday": {
			const nth = pattern.ordinal === -1 ? "last" : ordinal(pattern.ordinal);
			return `${everyPhrase(pattern.interval, "month")} on the ${nth} ${
				weekdayName(pattern.weekday, locale)
			}`;
		}
		case "yearly": {
			const date = dateFormat(locale, { day: "numeric", month: "long" })
				.format(new Date(Date.UTC(2000, pattern.month - 1, pattern.day)));
			return `Every year on ${date}`;
		}
		case "once": {
			const p = civilParts(pattern.date);
			return `On ${
				dateFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
					.format(new Date(Date.UTC(p.year, p.month - 1, p.day)))
			}`;
		}
	}
}
// #endregion

// #region Rule
/** The sentence-shaped slice of a rule. */
export type DescribableRule = Pick<
	AvailabilityRuleDraft,
	"layer" | "effect" | "pattern" | "condition" | "bands" | "startsOn" | "endsOn"
>;

function bandsPhrase(bands: readonly Band[], locale: string): string {
	return [...bands].sort((a, b) => a.start - b.start).map((b) =>
		`${time(b.start, locale)}–${time(b.end, locale)}`
	)
		.join(", ");
}

/**
 * One rule as a sentence, segments joined with " · ": the pattern, its range and any weekday
 * exception; the times (with the effect); and the layer.
 */
export function describeRule(draft: DescribableRule, locale = "en-GB"): string {
	let when = patternPhrase(draft.pattern, locale);
	if (draft.pattern.type !== "once") {
		when += ` from ${shortDate(draft.startsOn, locale, false)}`;
		if (draft.endsOn) when += ` until ${shortDate(draft.endsOn, locale, true)}`;
	}
	when += exceptionPhrase(draft.condition.unlessWeekdays, locale);
	const times = bandsPhrase(draft.bands, locale);
	const effect = draft.effect === "add"
		? times || "no times"
		: draft.effect === "replace"
		? times ? `${times} instead` : "nothing instead"
		: times
		? `not ${times}`
		: "the whole day off";
	const layer = draft.layer === "working_hours" ? "working hours" : "calls";
	return [when, effect, layer].join(" · ");
}
// #endregion

// #region Preset
/** A preset as the rule list renders it. */
export interface PresetDescription {
	/** A one-line count, e.g. "3 working-hours rules · 1 call rule · Europe/London". */
	summary: string;
	/** Each active rule's sentence, in the preset's order. */
	rules: { id: string; sentence: string }[];
}

/** The summary line and every active rule's sentence. */
export function describePreset(
	preset: PresetLike & { rules: readonly AvailabilityRuleDraft[] },
	locale = "en-GB",
): PresetDescription {
	const active = preset.rules.filter((r) => r.active);
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const working = active.filter((r) => r.layer === "working_hours").length;
	const calls = active.length - working;
	const parts = active.length
		? [
			count(working, "working-hours rule", "working-hours rules"),
			count(calls, "call rule", "call rules"),
		]
		: ["No rules"];
	return {
		summary: [...parts, preset.timezone].join(" · "),
		rules: active.map((r) => ({ id: r.id, sentence: describeRule(r, locale) })),
	};
}
// #endregion
