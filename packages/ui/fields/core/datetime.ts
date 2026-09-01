/**
 * Pure date-time arithmetic shared by the picker family (DatePicker · TimeTumbler · DateTimePicker).
 *
 * Every function here is total, side-effect free and framework-free, so the awkward parts — which
 * minutes a boundary day actually allows, how many days February has this year, what a drag of N
 * pixels means — can be reasoned about and unit-tested without a DOM. That is not incidental
 * tidiness: the pickers commit values from pointer, wheel and keystroke handlers, and a value the
 * reader must TRUST may never be a function of whether an animation frame happened to run (root
 * CLAUDE.md §8 Decision #60).
 *
 * Everything works in LOCAL WALL-CLOCK FIELDS, never in elapsed milliseconds. A day is not always
 * 1440 minutes long — the two DST transitions make one 1380 and one 1500 — so `(a - b) / 60000` is
 * the wrong arithmetic for "how far into this day is it", and it is wrong exactly twice a year in a
 * way no test written in July will catch.
 */

// #region Constants

/**
 * Minutes in one calendar day, counted in wall-clock FIELDS (`23:59` is minute 1439 on every day of
 * the year, including the two that are not 24 hours long).
 */
export const MINUTES_PER_DAY = 1440;

/** Full month names, January first — the vocabulary `MM` prints and the header dropdown lists. */
export const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/** Full weekday names, Sunday first, indexed to match `Date.prototype.getDay`. */
export const WEEKDAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

/**
 * Days in each month for a COMMON year, January first.
 *
 * February's entry is the common-year 28; {@link daysInMonth} adds the leap day rather than this
 * table carrying two versions of itself.
 */
const COMMON_YEAR_MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

// #endregion

// #region Numbers

/** Clamp `n` into the inclusive `[lo, hi]` range. */
export function clampToRange(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

/** Zero-padded two-digit string — the form every clock field is written in. */
export function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

// #endregion

// #region Calendar arithmetic

/**
 * Is `year` a leap year in the proleptic Gregorian calendar?
 *
 * All three clauses are load-bearing and the third is the one that gets dropped: 1900 and 2100 are
 * divisible by 4 and are NOT leap years, while 2000 is divisible by 100 and IS one. A picker whose
 * year span reaches a century boundary — every date-of-birth field does — offers a 29th of February
 * that does not exist without it.
 */
export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * How many days month `month` (0 = January) has in `year`.
 *
 * Read from a table rather than from `new Date(year, month + 1, 0).getDate()`, which is the usual
 * trick and works, because a table cannot be moved by the constructor's own normalisation and reads
 * the same in a test as it does in a handler. Out-of-range months wrap into the calendar year, so a
 * caller stepping a month counter past December never indexes past the end of the table.
 */
export function daysInMonth(year: number, month: number): number {
	const m = ((Math.trunc(month) % 12) + 12) % 12;
	return m === 1 && isLeapYear(year) ? 29 : COMMON_YEAR_MONTH_LENGTHS[m];
}

/**
 * `day` if `year`/`month` can hold it, otherwise that month's last day.
 *
 * The accommodation applied when the MONTH is what the reader just changed: they asked for February,
 * so February is what they get, and the 31 they had selected yields to the 28th or 29th.
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
	return clampToRange(Math.trunc(day), 1, daysInMonth(year, month));
}

// #endregion

// #region Formatting

/**
 * Format a date with the taxonomy's token grammar.
 *
 * | Token  | Renders                   | Example     |
 * | :----- | :------------------------ | :---------- |
 * | `d`    | day of month, unpadded    | `5`         |
 * | `dd`   | day of month, two digits  | `05`        |
 * | `D`    | weekday name, abbreviated | `Wed`       |
 * | `DD`   | weekday name, full        | `Wednesday` |
 * | `m`    | month number, unpadded    | `4`         |
 * | `mm`   | month number, two digits  | `04`        |
 * | `M`    | month name, abbreviated   | `Apr`       |
 * | `MM`   | month name, full          | `April`     |
 * | `yy`   | year, two digits          | `23`        |
 * | `yyyy` | year, four digits         | `2023`      |
 *
 * The four NAME tokens are case-distinguished from their numeric partners, which is the grammar
 * PrimeNG's Calendar uses and the one every caller in this repo was already written against. They
 * were absent from the implementation while three shipping surfaces asked for them, so
 * `dateFormat="dd M yy"` emitted the letter itself and a date of `12/05/2023` printed as
 * `12 M 2023`. An unrecognised token is passed through verbatim, so that class of failure is silent
 * by construction: the only defence is that the grammar the docblock advertises and the grammar the
 * regex implements are the same set.
 *
 * Deliberately not `Intl.DateTimeFormat`: the callers expose an explicit `dateFormat` prop, so the
 * order of the fields is the caller's decision rather than the runtime locale's, and two pickers on
 * one screen cannot disagree about it.
 */
export function formatDatePattern(d: Date, format: string): string {
	const map: Record<string, string> = {
		yyyy: String(d.getFullYear()),
		yy: pad2(d.getFullYear() % 100),
		MM: MONTH_NAMES[d.getMonth()],
		M: MONTH_NAMES[d.getMonth()].slice(0, 3),
		mm: pad2(d.getMonth() + 1),
		m: String(d.getMonth() + 1),
		DD: WEEKDAY_NAMES[d.getDay()],
		D: WEEKDAY_NAMES[d.getDay()].slice(0, 3),
		dd: pad2(d.getDate()),
		d: String(d.getDate()),
	};
	// Longest-first within each letter (`yyyy` before `yy`, `MM` before `M`), or the shorter token
	// matches first and the remaining character falls through to the literal branch.
	return format.replace(/yyyy|yy|MM|M|mm|m|DD|D|dd|d/g, (t) => map[t] ?? t);
}

/**
 * The wire form a date-time is submitted in: `YYYY-MM-DDTHH:mm` in LOCAL time.
 *
 * The same shape a native `<input type="datetime-local">` posts, and deliberately not
 * `Date.prototype.toISOString`, which converts to UTC — west of Greenwich that silently posts the
 * previous day for anything before the offset, which is the classic "my booking moved" bug.
 */
export function toLocalIsoMinute(d: Date): string {
	return `${toLocalIsoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The wire form a date is submitted in: `YYYY-MM-DD` in LOCAL fields, for the same reason. */
export function toLocalIsoDate(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Render a minute-of-day as a clock string — `09:05`, or `9:05 AM` when `hour12`.
 *
 * Midnight and noon are the two the modulo gets wrong if written naively: hour 0 and hour 12 both
 * read as `12` on a 12-hour clock, which `((h + 11) % 12) + 1` produces and `h % 12` does not.
 */
export function formatTimeOfDay(minutes: number, hour12: boolean): string {
	const m = clampToRange(Math.trunc(minutes), 0, MINUTES_PER_DAY - 1);
	const h = Math.floor(m / 60);
	const body = `${hour12 ? ((h + 11) % 12) + 1 : pad2(h)}:${pad2(m % 60)}`;
	return hour12 ? `${body} ${h < 12 ? "AM" : "PM"}` : body;
}

// #endregion

// #region Day / time decomposition

/** Minutes elapsed since local midnight, read from wall-clock fields. */
export function minutesOfDay(d: Date): number {
	return d.getHours() * 60 + d.getMinutes();
}

/** Local midnight of `d`. */
export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Compare two dates by CALENDAR DAY only: negative if `a` falls on an earlier day than `b`. */
export function compareDays(a: Date, b: Date): number {
	const ay = a.getFullYear() - b.getFullYear();
	if (ay !== 0) return ay;
	const am = a.getMonth() - b.getMonth();
	if (am !== 0) return am;
	return a.getDate() - b.getDate();
}

/**
 * A new `Date` on `day`'s calendar day, `minutes` past local midnight.
 *
 * The hour and minute are handed to the constructor as separate fields rather than as one minute
 * count so the value is a wall-clock time on that day. On a spring-forward day the requested hour may
 * not exist, and the constructor's normalisation lands on the next real instant — the standard,
 * and only available, answer.
 */
export function withMinutes(day: Date, minutes: number): Date {
	const m = clampToRange(Math.trunc(minutes), 0, MINUTES_PER_DAY - 1);
	return new Date(
		day.getFullYear(),
		day.getMonth(),
		day.getDate(),
		Math.floor(m / 60),
		m % 60,
		0,
		0,
	);
}

// #endregion

// #region Bounds

/** The minute-of-day window a single day allows. `lo <= hi` always holds. */
export interface TimeWindow {
	/** Earliest selectable minute of the day, inclusive. */
	lo: number;
	/** Latest selectable minute of the day, inclusive. */
	hi: number;
}

/**
 * The minute-of-day window `day` allows, given optional instant bounds.
 *
 * This is the whole reason a date-time picker is not a date picker with a clock glued under it: a
 * `min` of Friday 09:00 constrains Friday's HOURS and says nothing about Saturday's. Offering a legal
 * date and then an illegal hour on it is worse than refusing both, because the reader only discovers
 * the refusal after committing.
 *
 * A day entirely outside the bounds collapses to a single minute rather than throwing. Such a day is
 * already refused by the calendar, so this is a guard against an inconsistent caller, not a path
 * anyone is meant to reach — and a degenerate window is still a window every consumer can read.
 */
export function dayTimeBounds(
	day: Date,
	min?: Date | null,
	max?: Date | null,
): TimeWindow {
	let lo = 0;
	let hi = MINUTES_PER_DAY - 1;
	if (min) {
		const c = compareDays(min, day);
		lo = c > 0 ? MINUTES_PER_DAY - 1 : c === 0 ? clampToRange(minutesOfDay(min), 0, hi) : 0;
	}
	if (max) {
		const c = compareDays(max, day);
		hi = c < 0 ? 0 : c === 0 ? clampToRange(minutesOfDay(max), 0, MINUTES_PER_DAY - 1) : hi;
	}
	return lo > hi ? { lo: hi, hi } : { lo, hi };
}

// #endregion
