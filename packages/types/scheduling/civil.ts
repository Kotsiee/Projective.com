import { z } from "zod";

/**
 * scheduling.civil — timezone-free CIVIL date arithmetic, plus the one bridge from a civil date and
 * a wall-clock minute to an absolute instant ({@link zonedSpan}).
 *
 * Recurrence is expanded over calendar dates, never over instants: "every other Wednesday" is a fact
 * about the Gregorian calendar, and walking it in epoch milliseconds would drift by an hour twice a
 * year in every zone with daylight saving. Every function here except {@link zonedSpan} is therefore
 * exact integer arithmetic on day numbers with no zone in sight; the zone enters exactly once, at
 * the end, when a band on a date becomes a span on the timeline.
 *
 * Pure: no clock, no IO, no DOM.
 */

// #region IsoDate
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A civil calendar date, `YYYY-MM-DD`, validated to exist (no 30 February). */
export const IsoDate = z.string().regex(ISO_DATE_RE, "Expected a date as YYYY-MM-DD.").refine(
	(s) => isValidIsoDate(s),
	"That date does not exist.",
).brand<"IsoDate">();
export type IsoDate = z.infer<typeof IsoDate>;

/** A date's numeric parts; `month` is 1–12. */
export interface CivilParts {
	year: number;
	month: number;
	day: number;
}

/** A closed civil date range, both ends inclusive. */
export interface DateRange {
	from: IsoDate;
	to: IsoDate;
}

function isValidIsoDate(s: string): boolean {
	const m = ISO_DATE_RE.exec(s);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Read `s` as an {@link IsoDate}, or `null` when it is not a real date. */
export function parseIsoDate(s: string): IsoDate | null {
	return isValidIsoDate(s) ? s as IsoDate : null;
}

/** Build an {@link IsoDate} from its parts; out-of-range parts roll over (`2026-13-01` → 2027-01-01). */
export function isoDateOf(year: number, month: number, day: number): IsoDate {
	return fromDayNumber(Math.round(Date.UTC(year, month - 1, day) / DAY_MS));
}

/** The numeric parts of a date. */
export function civilParts(date: IsoDate): CivilParts {
	return {
		year: Number(date.slice(0, 4)),
		month: Number(date.slice(5, 7)),
		day: Number(date.slice(8, 10)),
	};
}
// #endregion

// #region Day numbers
/** Days since 1970-01-01 — the integer every civil step is taken in. */
export function toDayNumber(date: IsoDate): number {
	const p = civilParts(date);
	return Math.round(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/** The date `n` days after 1970-01-01. */
export function fromDayNumber(n: number): IsoDate {
	const d = new Date(n * DAY_MS);
	const y = d.getUTCFullYear();
	const mo = d.getUTCMonth() + 1;
	const day = d.getUTCDate();
	return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${
		String(day).padStart(2, "0")
	}` as IsoDate;
}
// #endregion

// #region Arithmetic
/** Whether `year` is a Gregorian leap year. */
export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The number of days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `date` moved by `n` days (negative moves back). */
export function addDays(date: IsoDate, n: number): IsoDate {
	return fromDayNumber(toDayNumber(date) + n);
}

/**
 * `date` moved by `n` calendar months, CLAMPED to the target month's last day — 31 January plus one
 * month is 28 (or 29) February, never 3 March.
 */
export function addMonths(date: IsoDate, n: number): IsoDate {
	const p = civilParts(date);
	const index = p.year * 12 + (p.month - 1) + n;
	const year = Math.floor(index / 12);
	const month = index - year * 12 + 1;
	return isoDateOf(year, month, Math.min(p.day, daysInMonth(year, month)));
}

/** 0 = Sunday … 6 = Saturday, matching `Date#getDay` and `availability_rules.weekday`. */
export function weekdayOf(date: IsoDate): number {
	// 1970-01-01 was a Thursday (4).
	return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

/**
 * The `ordinal`-th `weekday` of a month: `1` is the first, `-1` the last, `-2` the second-to-last.
 * `null` when the month has no such day (a fifth Monday in a four-Monday month).
 */
export function nthWeekdayOfMonth(
	year: number,
	month: number,
	weekday: number,
	ordinal: number,
): IsoDate | null {
	if (ordinal === 0) return null;
	const last = daysInMonth(year, month);
	if (ordinal > 0) {
		const firstWd = weekdayOf(isoDateOf(year, month, 1));
		const day = 1 + ((weekday - firstWd + 7) % 7) + (ordinal - 1) * 7;
		return day <= last ? isoDateOf(year, month, day) : null;
	}
	const lastWd = weekdayOf(isoDateOf(year, month, last));
	const day = last - ((lastWd - weekday + 7) % 7) + (ordinal + 1) * 7;
	return day >= 1 ? isoDateOf(year, month, day) : null;
}

/** `-1`, `0` or `1` as `a` is before, equal to or after `b`. ISO dates order lexically. */
export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Every date from `from` to `to`, both inclusive; empty when `to` precedes `from`. */
export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
	const out: IsoDate[] = [];
	const end = toDayNumber(to);
	for (let n = toDayNumber(from); n <= end; n++) out.push(fromDayNumber(n));
	return out;
}
// #endregion

// #region Zones
const offsetFormatters = new Map<string, Intl.DateTimeFormat | null>();

function offsetFormatter(tz: string): Intl.DateTimeFormat | null {
	if (offsetFormatters.has(tz)) return offsetFormatters.get(tz) ?? null;
	let fmt: Intl.DateTimeFormat | null;
	try {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		fmt = null;
	}
	offsetFormatters.set(tz, fmt);
	return fmt;
}

/** Whether the runtime recognises `tz` as a time zone. */
export function isKnownTimezone(tz: string): boolean {
	return offsetFormatter(tz) !== null;
}

/** Milliseconds `tz` is ahead of UTC at the instant `ms`; `0` for a zone the runtime does not know. */
function offsetAt(ms: number, tz: string): number {
	const fmt = offsetFormatter(tz);
	if (!fmt) return 0;
	const map: Record<string, string> = {};
	for (const part of fmt.formatToParts(new Date(ms))) {
		if (part.type !== "literal") map[part.type] = part.value;
	}
	const wall = Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
		map.hour === "24" ? 0 : Number(map.hour),
		Number(map.minute),
		Number(map.second),
	);
	return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * The instant a WALL-CLOCK reading falls at in `tz`, where `wall` is that reading encoded as if it
 * were UTC (`Date.UTC(y, m, d, h, mi)`).
 *
 * Plan §5.2 step 5: in a DST overlap the reading exists twice and the FIRST (earlier) instant is
 * used; in a DST gap it does not exist at all and resolves to the gap's end — the instant the clock
 * jumps to. Candidates are probed with the offsets either side of the reading, so a transition
 * within a day of it is always seen.
 */
function wallToInstant(wall: number, tz: string): number {
	const offsets = new Set([
		offsetAt(wall - DAY_MS, tz),
		offsetAt(wall, tz),
		offsetAt(wall + DAY_MS, tz),
	]);
	let best: number | null = null;
	for (const o of offsets) {
		const t = wall - o;
		if (offsetAt(t, tz) === o && (best === null || t < best)) best = t;
	}
	if (best !== null) return best;

	// In a gap: the offset before the transition is the smaller one. `lo` sits before the jump and
	// `hi` after it; bisect to the first instant carrying the later offset.
	const sorted = [...offsets].sort((a, b) => a - b);
	const before = sorted[0];
	const after = sorted[sorted.length - 1];
	let lo = wall - after;
	let hi = wall - before;
	while (hi - lo > 1000) {
		const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
		if (offsetAt(mid, tz) === before) lo = mid;
		else hi = mid;
	}
	return hi;
}

/** An absolute span, epoch milliseconds, `endsAt` exclusive. */
export interface ZonedSpan {
	startsAt: number;
	endsAt: number;
}

/**
 * The absolute span a band of `date` covers in `tz`, minutes measured from that date's local
 * midnight (`endMinute` may be 1440, the next midnight).
 *
 * DST follows plan §5.2 step 5 for BOTH ends: a reading inside a gap resolves to the gap's end, a
 * reading inside an overlap to its first occurrence. A band lying wholly inside a gap therefore
 * collapses to zero length, which the evaluator drops. An unknown zone is read as UTC, the one
 * fallback that never shifts an instant by a hidden amount.
 */
export function zonedSpan(
	date: IsoDate,
	startMinute: number,
	endMinute: number,
	tz: string,
): ZonedSpan {
	const midnight = toDayNumber(date) * DAY_MS;
	return {
		startsAt: wallToInstant(midnight + startMinute * 60_000, tz),
		endsAt: wallToInstant(midnight + endMinute * 60_000, tz),
	};
}

/** The civil date an instant falls on in `tz`. */
export function dateInZone(ms: number, tz: string): IsoDate {
	return fromDayNumber(Math.floor((ms + offsetAt(ms, tz)) / DAY_MS));
}

/** The civil date and minute-of-day an instant reads as on a wall clock in `tz`. */
export function wallClockInZone(ms: number, tz: string): { date: IsoDate; minute: number } {
	const local = ms + offsetAt(ms, tz);
	const day = Math.floor(local / DAY_MS);
	return { date: fromDayNumber(day), minute: Math.floor((local - day * DAY_MS) / 60_000) };
}
// #endregion
