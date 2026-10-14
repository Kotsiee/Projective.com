import {
	civilParts,
	daysInMonth,
	fromDayNumber,
	type IsoDate,
	isoDateOf,
	parseIsoDate,
	toDayNumber,
	weekdayOf,
} from "./civil.ts";
import type { DateRange } from "./civil.ts";

/**
 * scheduling.rrule — a dependency-free RFC 5545 `RRULE` SUBSET: parse, canonical serialise and
 * expand over civil dates (plan §5.3).
 *
 * The time of day is deliberately absent: a rule here answers only "which DATES", and the bands a
 * rule carries say when on each date. `DTSTART` is carried separately as `startsOn`, so the parts
 * below never contain it.
 *
 * Supported: `FREQ` (DAILY · WEEKLY · MONTHLY · YEARLY), `INTERVAL`, `BYDAY` (an ordinal only under
 * MONTHLY or YEARLY), `BYMONTHDAY` (negative counts from the month's end), `BYMONTH`, `BYSETPOS`,
 * `UNTIL` (a date) and `WKST`. Everything else is REFUSED with a named reason rather than ignored:
 * a part silently dropped is a rule that means something other than what its author wrote.
 */

// #region Parts
/** RFC 5545 frequencies this subset expands. */
export type RRuleFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** One `BYDAY` entry: a weekday (0 = Sunday) and, under MONTHLY/YEARLY, an optional ordinal. */
export interface RRuleByDay {
	wd: number;
	ordinal?: number;
}

/**
 * A parsed rule. Always CANONICAL: lists are sorted ascending and de-duplicated (`byDay` by weekday,
 * then ordinal), so two spellings of one rule compare equal.
 */
export interface RRuleParts {
	freq: RRuleFreq;
	interval: number;
	byDay: RRuleByDay[];
	byMonthDay: number[];
	byMonth: number[];
	bySetPos: number[];
	until?: IsoDate;
	/** Week start, 0 = Sunday … 6 = Saturday; RFC default Monday (1). */
	wkst: number;
}

/** Why a rule string was refused. */
export type RRuleRefusal =
	| "empty"
	| "malformed"
	| "duplicate_part"
	| "missing_freq"
	| "freq_unsupported"
	| "count_unsupported"
	| "time_of_day_unsupported"
	| "part_unsupported"
	| "invalid_value"
	| "ordinal_not_allowed"
	| "monthday_not_allowed"
	| "setpos_needs_by_part"
	| "until_not_a_date";

/** The refusal copy, written once so the parser and every surface say the same thing. */
export const RRULE_REFUSAL_COPY: Record<RRuleRefusal, string> = {
	empty: "The rule is empty.",
	malformed: "The rule is not written as NAME=VALUE parts separated by semicolons.",
	duplicate_part: "A part appears more than once.",
	missing_freq: "The rule has no FREQ.",
	freq_unsupported: "Only DAILY, WEEKLY, MONTHLY and YEARLY rules are supported.",
	count_unsupported: "COUNT is not supported — set an end date instead.",
	time_of_day_unsupported:
		"BYHOUR, BYMINUTE and BYSECOND are not supported — the bands carry the time of day.",
	part_unsupported: "That rule part is not supported.",
	invalid_value: "A part has a value outside its range.",
	ordinal_not_allowed: "A numbered weekday (like 2TU) only works in monthly or yearly rules.",
	monthday_not_allowed: "BYMONTHDAY cannot be used in a weekly rule.",
	setpos_needs_by_part: "BYSETPOS needs another BY part to pick from.",
	until_not_a_date: "UNTIL must be a date (YYYYMMDD).",
};

/** The outcome of {@link parseRRule}. */
export type RRuleParse =
	| { ok: true; value: RRuleParts }
	| { ok: false; reason: RRuleRefusal; part: string | null; message: string };
// #endregion

// #region Codes
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const FREQS: readonly RRuleFreq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const UNSUPPORTED_FREQS = ["SECONDLY", "MINUTELY", "HOURLY"];
const TIME_PARTS = ["BYHOUR", "BYMINUTE", "BYSECOND"];
const OTHER_PARTS = ["BYWEEKNO", "BYYEARDAY", "RSCALE", "SKIP"];

/** The two-letter RFC code of a weekday (0 = `SU`). */
export function weekdayCode(wd: number): string {
	return WEEKDAY_CODES[wd];
}
// #endregion

// #region Parse
function refuse(reason: RRuleRefusal, part: string | null = null): RRuleParse {
	return { ok: false, reason, part, message: RRULE_REFUSAL_COPY[reason] };
}

function intList(value: string, min: number, max: number, nonZero: boolean): number[] | null {
	const out: number[] = [];
	for (const raw of value.split(",")) {
		if (!/^[+-]?\d{1,3}$/.test(raw)) return null;
		const n = Number(raw);
		if (n < min || n > max || (nonZero && n === 0)) return null;
		out.push(n);
	}
	return out;
}

function sortedUnique(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

function canonicalByDay(entries: RRuleByDay[]): RRuleByDay[] {
	const seen = new Map<string, RRuleByDay>();
	for (const e of entries) seen.set(`${e.wd}:${e.ordinal ?? ""}`, e);
	return [...seen.values()].sort((a, b) =>
		a.wd - b.wd || (a.ordinal ?? -100) - (b.ordinal ?? -100)
	);
}

/**
 * Parse an `RRULE` value (an optional `RRULE:` prefix is accepted). Names and values are read
 * case-insensitively; the result is canonical ({@link RRuleParts}).
 */
export function parseRRule(s: string): RRuleParse {
	const body = s.trim().replace(/^RRULE:/i, "").trim();
	if (!body) return refuse("empty");

	const raw = new Map<string, string>();
	for (const segment of body.split(";")) {
		if (!segment) continue;
		const eq = segment.indexOf("=");
		if (eq <= 0 || eq === segment.length - 1) return refuse("malformed", segment);
		const name = segment.slice(0, eq).trim().toUpperCase();
		if (raw.has(name)) return refuse("duplicate_part", name);
		raw.set(name, segment.slice(eq + 1).trim().toUpperCase());
	}

	for (const name of raw.keys()) {
		if (name === "COUNT") return refuse("count_unsupported", name);
		if (TIME_PARTS.includes(name)) return refuse("time_of_day_unsupported", name);
		if (OTHER_PARTS.includes(name)) return refuse("part_unsupported", name);
		if (
			!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "UNTIL", "WKST"].includes(
				name,
			)
		) {
			return refuse("part_unsupported", name);
		}
	}

	const freqRaw = raw.get("FREQ");
	if (!freqRaw) return refuse("missing_freq");
	if (UNSUPPORTED_FREQS.includes(freqRaw)) return refuse("freq_unsupported", "FREQ");
	const freq = FREQS.find((f) => f === freqRaw);
	if (!freq) return refuse("invalid_value", "FREQ");

	let interval = 1;
	const intervalRaw = raw.get("INTERVAL");
	if (intervalRaw !== undefined) {
		if (!/^\d{1,4}$/.test(intervalRaw) || Number(intervalRaw) < 1) {
			return refuse("invalid_value", "INTERVAL");
		}
		interval = Number(intervalRaw);
	}

	const byDay: RRuleByDay[] = [];
	const byDayRaw = raw.get("BYDAY");
	if (byDayRaw !== undefined) {
		for (const entry of byDayRaw.split(",")) {
			const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry);
			if (!m) return refuse("invalid_value", "BYDAY");
			const wd = WEEKDAY_CODES.indexOf(m[2] as typeof WEEKDAY_CODES[number]);
			if (m[1] === undefined) {
				byDay.push({ wd });
				continue;
			}
			if (freq !== "MONTHLY" && freq !== "YEARLY") return refuse("ordinal_not_allowed", "BYDAY");
			const ordinal = Number(m[1]);
			const limit = freq === "MONTHLY" ? 5 : 53;
			if (ordinal === 0 || Math.abs(ordinal) > limit) return refuse("invalid_value", "BYDAY");
			byDay.push({ wd, ordinal });
		}
	}

	const lists: Record<string, number[]> = {};
	for (
		const [name, min, max] of [["BYMONTHDAY", -31, 31], ["BYMONTH", 1, 12], [
			"BYSETPOS",
			-366,
			366,
		]] as const
	) {
		const value = raw.get(name);
		if (value === undefined) {
			lists[name] = [];
			continue;
		}
		const parsed = intList(value, min, max, true);
		if (!parsed) return refuse("invalid_value", name);
		lists[name] = sortedUnique(parsed);
	}
	if (freq === "WEEKLY" && lists.BYMONTHDAY.length > 0) {
		return refuse("monthday_not_allowed", "BYMONTHDAY");
	}
	if (
		lists.BYSETPOS.length > 0 && byDay.length === 0 && lists.BYMONTHDAY.length === 0 &&
		lists.BYMONTH.length === 0
	) {
		return refuse("setpos_needs_by_part", "BYSETPOS");
	}

	let until: IsoDate | undefined;
	const untilRaw = raw.get("UNTIL");
	if (untilRaw !== undefined) {
		const m = /^(\d{4})(\d{2})(\d{2})$/.exec(untilRaw);
		const date = m ? parseIsoDate(`${m[1]}-${m[2]}-${m[3]}`) : null;
		if (!date) return refuse("until_not_a_date", "UNTIL");
		until = date;
	}

	let wkst = 1;
	const wkstRaw = raw.get("WKST");
	if (wkstRaw !== undefined) {
		const wd = WEEKDAY_CODES.indexOf(wkstRaw as typeof WEEKDAY_CODES[number]);
		if (wd < 0) return refuse("invalid_value", "WKST");
		wkst = wd;
	}

	const value: RRuleParts = {
		freq,
		interval,
		byDay: canonicalByDay(byDay),
		byMonthDay: lists.BYMONTHDAY,
		byMonth: lists.BYMONTH,
		bySetPos: lists.BYSETPOS,
		wkst,
	};
	if (until) value.until = until;
	return { ok: true, value };
}
// #endregion

// #region Serialise
/**
 * Render parts in the canonical order `FREQ;INTERVAL;BYMONTH;BYMONTHDAY;BYDAY;BYSETPOS;UNTIL;WKST`,
 * omitting `INTERVAL=1` and `WKST=MO`. `parseRRule(serialiseRRule(p))` deep-equals any canonical `p`.
 */
export function serialiseRRule(p: RRuleParts): string {
	const out = [`FREQ=${p.freq}`];
	if (p.interval !== 1) out.push(`INTERVAL=${p.interval}`);
	if (p.byMonth.length) out.push(`BYMONTH=${p.byMonth.join(",")}`);
	if (p.byMonthDay.length) out.push(`BYMONTHDAY=${p.byMonthDay.join(",")}`);
	if (p.byDay.length) {
		out.push(`BYDAY=${p.byDay.map((d) => `${d.ordinal ?? ""}${WEEKDAY_CODES[d.wd]}`).join(",")}`);
	}
	if (p.bySetPos.length) out.push(`BYSETPOS=${p.bySetPos.join(",")}`);
	if (p.until) out.push(`UNTIL=${p.until.replaceAll("-", "")}`);
	if (p.wkst !== 1) out.push(`WKST=${WEEKDAY_CODES[p.wkst]}`);
	return out.join(";");
}
// #endregion

// #region Expand
/** The most occurrences one rule yields per expansion call (plan §5.3). */
export const RRULE_EXPANSION_CAP = 2000;

function monthDaysOf(year: number, month: number, byMonthDay: readonly number[]): number[] {
	const last = daysInMonth(year, month);
	const out: number[] = [];
	for (const d of byMonthDay) {
		const day = d > 0 ? d : last + d + 1;
		if (day >= 1 && day <= last) out.push(day);
	}
	return out;
}

/** Every `wd` of a span of day numbers, inclusive. */
function weekdaysIn(startDay: number, endDay: number, wd: number): number[] {
	const out: number[] = [];
	const first = startDay + ((wd - ((startDay + 4) % 7 + 7) % 7) + 7) % 7;
	for (let n = first; n <= endDay; n += 7) out.push(n);
	return out;
}

/** The day numbers `entry` selects inside `[startDay, endDay]`, ordinal counted within that span. */
function byDayIn(startDay: number, endDay: number, entry: RRuleByDay): number[] {
	const all = weekdaysIn(startDay, endDay, entry.wd);
	if (entry.ordinal === undefined) return all;
	const pick = entry.ordinal > 0 ? all[entry.ordinal - 1] : all[all.length + entry.ordinal];
	return pick === undefined ? [] : [pick];
}

function matchesByDay(
	dayNumber: number,
	spanStart: number,
	spanEnd: number,
	byDay: readonly RRuleByDay[],
): boolean {
	return byDay.some((entry) =>
		entry.ordinal === undefined
			? ((dayNumber + 4) % 7 + 7) % 7 === entry.wd
			: byDayIn(spanStart, spanEnd, entry).includes(dayNumber)
	);
}

function monthSpan(year: number, month: number): [number, number] {
	const start = toDayNumber(isoDateOf(year, month, 1));
	return [start, start + daysInMonth(year, month) - 1];
}

/** The candidate set of one MONTHLY period, before BYSETPOS. */
function monthlySet(p: RRuleParts, year: number, month: number, anchorDay: number): number[] {
	if (p.byMonth.length && !p.byMonth.includes(month)) return [];
	const [start, end] = monthSpan(year, month);
	if (p.byMonthDay.length) {
		const days = monthDaysOf(year, month, p.byMonthDay).map((d) => start + d - 1);
		return p.byDay.length ? days.filter((n) => matchesByDay(n, start, end, p.byDay)) : days;
	}
	if (p.byDay.length) return p.byDay.flatMap((entry) => byDayIn(start, end, entry));
	return anchorDay <= daysInMonth(year, month) ? [start + anchorDay - 1] : [];
}

/** The candidate set of one YEARLY period, before BYSETPOS. */
function yearlySet(p: RRuleParts, year: number, anchor: { month: number; day: number }): number[] {
	const months = p.byMonth.length
		? p.byMonth
		: p.byMonthDay.length || p.byDay.length
		? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
		: [anchor.month];
	const yearStart = toDayNumber(isoDateOf(year, 1, 1));
	const yearEnd = toDayNumber(isoDateOf(year, 12, 31));
	const out: number[] = [];
	if (p.byMonthDay.length) {
		for (const month of months) {
			const [start, end] = monthSpan(year, month);
			for (const d of monthDaysOf(year, month, p.byMonthDay)) {
				const n = start + d - 1;
				const ok = !p.byDay.length ||
					(p.byMonth.length
						? matchesByDay(n, start, end, p.byDay)
						: matchesByDay(n, yearStart, yearEnd, p.byDay));
				if (ok) out.push(n);
			}
		}
		return out;
	}
	if (p.byDay.length) {
		if (!p.byMonth.length) return p.byDay.flatMap((entry) => byDayIn(yearStart, yearEnd, entry));
		for (const month of months) {
			const [start, end] = monthSpan(year, month);
			for (const entry of p.byDay) out.push(...byDayIn(start, end, entry));
		}
		return out;
	}
	for (const month of months) {
		if (anchor.day <= daysInMonth(year, month)) {
			out.push(toDayNumber(isoDateOf(year, month, anchor.day)));
		}
	}
	return out;
}

function applySetPos(set: number[], bySetPos: readonly number[]): number[] {
	const sorted = sortedUnique(set);
	if (!bySetPos.length) return sorted;
	const picked: number[] = [];
	for (const pos of bySetPos) {
		const n = pos > 0 ? sorted[pos - 1] : sorted[sorted.length + pos];
		if (n !== undefined) picked.push(n);
	}
	return sortedUnique(picked);
}

function dailyMatches(p: RRuleParts, n: number): boolean {
	const date = fromDayNumber(n);
	const { year, month, day } = civilParts(date);
	if (p.byMonth.length && !p.byMonth.includes(month)) return false;
	if (p.byMonthDay.length && !monthDaysOf(year, month, p.byMonthDay).includes(day)) return false;
	if (p.byDay.length && !p.byDay.some((e) => e.wd === weekdayOf(date))) return false;
	return true;
}

/**
 * The dates `p` yields inside `range`, anchored at `startsOn` (its DTSTART), ascending.
 *
 * RFC 5545 semantics for the subset: WEEKLY weeks are counted from the week containing `startsOn`
 * (weeks begin on `WKST`) modulo INTERVAL; MONTHLY intersects BYMONTHDAY with BYDAY when both are
 * present, an ordinal BYDAY picks the nth weekday, and BYSETPOS filters each period's set; YEARLY
 * expands BYMONTH × BYMONTHDAY. A rule with no day part repeats `startsOn`'s weekday, day or date,
 * and a date that does not exist in a period (31 April) is skipped, never moved.
 *
 * Never yields a date before `startsOn` or after `UNTIL`, and at most `cap` dates. Periods before
 * `range.from` are skipped arithmetically, so a rule anchored years ago costs nothing extra.
 */
export function expandRRule(
	p: RRuleParts,
	startsOn: IsoDate,
	range: DateRange,
	cap = RRULE_EXPANSION_CAP,
): IsoDate[] {
	const startDay = toDayNumber(startsOn);
	const fromDay = Math.max(startDay, toDayNumber(range.from));
	let toDay = toDayNumber(range.to);
	if (p.until) toDay = Math.min(toDay, toDayNumber(p.until));
	if (toDay < fromDay || cap <= 0) return [];

	const out: IsoDate[] = [];
	const emit = (days: number[]): boolean => {
		for (const n of days) {
			if (n < fromDay || n > toDay) continue;
			out.push(fromDayNumber(n));
			if (out.length >= cap) return false;
		}
		return true;
	};
	const firstPeriod = (index: number): number =>
		Math.max(0, Math.ceil(index / p.interval)) * p.interval;

	if (p.freq === "DAILY") {
		for (let n = startDay + firstPeriod(fromDay - startDay); n <= toDay; n += p.interval) {
			if (dailyMatches(p, n) && !emit(applySetPos([n], p.bySetPos))) break;
		}
		return out;
	}

	if (p.freq === "WEEKLY") {
		const weekStartOf = (n: number) => n - (((((n + 4) % 7) + 7) % 7 - p.wkst + 7) % 7);
		const anchorWeek = weekStartOf(startDay);
		const days = p.byDay.length ? p.byDay.map((e) => e.wd) : [weekdayOf(startsOn)];
		const offsets = days.map((wd) => (wd - p.wkst + 7) % 7);
		let week = anchorWeek + firstPeriod(Math.floor((weekStartOf(fromDay) - anchorWeek) / 7)) * 7;
		for (; week <= toDay; week += p.interval * 7) {
			const set = offsets.map((o) => week + o).filter((n) =>
				!p.byMonth.length || p.byMonth.includes(civilParts(fromDayNumber(n)).month)
			);
			if (!emit(applySetPos(set, p.bySetPos))) break;
		}
		return out;
	}

	const anchor = civilParts(startsOn);
	if (p.freq === "MONTHLY") {
		const anchorIndex = anchor.year * 12 + anchor.month - 1;
		const from = civilParts(fromDayNumber(fromDay));
		const to = civilParts(fromDayNumber(toDay));
		const lastIndex = to.year * 12 + to.month - 1;
		for (
			let i = anchorIndex + firstPeriod(from.year * 12 + from.month - 1 - anchorIndex);
			i <= lastIndex;
			i += p.interval
		) {
			const year = Math.floor(i / 12);
			if (!emit(applySetPos(monthlySet(p, year, i - year * 12 + 1, anchor.day), p.bySetPos))) break;
		}
		return out;
	}

	const fromYear = civilParts(fromDayNumber(fromDay)).year;
	const toYear = civilParts(fromDayNumber(toDay)).year;
	for (let y = anchor.year + firstPeriod(fromYear - anchor.year); y <= toYear; y += p.interval) {
		if (!emit(applySetPos(yearlySet(p, y, anchor), p.bySetPos))) break;
	}
	return out;
}
// #endregion
