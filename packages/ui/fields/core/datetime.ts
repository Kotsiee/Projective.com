/**
 * Pure date-time arithmetic shared by the picker family (DatePicker · TimeTumbler · DateTimePicker).
 *
 * Every function here is total, side-effect free and framework-free, so the awkward parts — which
 * minutes a boundary day actually allows, what a drag of N pixels means — can be reasoned about and
 * unit-tested without a DOM. That is not incidental tidiness: the pickers commit values from pointer
 * and wheel handlers, and a value the reader must TRUST may never be a function of whether an
 * animation frame happened to run (root CLAUDE.md §8 Decision #60).
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

// #region Formatting

/**
 * Format a date with the taxonomy's token grammar (`d dd m mm yy yyyy`).
 *
 * Deliberately not `Intl.DateTimeFormat`: the callers expose an explicit `dateFormat` prop, so the
 * order of the fields is the caller's decision rather than the runtime locale's, and two pickers on
 * one screen cannot disagree about it.
 */
export function formatDatePattern(d: Date, format: string): string {
	const map: Record<string, string> = {
		yyyy: String(d.getFullYear()),
		yy: pad2(d.getFullYear() % 100),
		mm: pad2(d.getMonth() + 1),
		m: String(d.getMonth() + 1),
		dd: pad2(d.getDate()),
		d: String(d.getDate()),
	};
	return format.replace(/yyyy|yy|mm|m|dd|d/g, (t) => map[t] ?? t);
}

/**
 * The wire form a date-time is submitted in: `YYYY-MM-DDTHH:mm` in LOCAL time.
 *
 * The same shape a native `<input type="datetime-local">` posts, and deliberately not
 * `Date.prototype.toISOString`, which converts to UTC — west of Greenwich that silently posts the
 * previous day for anything before the offset, which is the classic "my booking moved" bug.
 */
export function toLocalIsoMinute(d: Date): string {
	const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	return `${date}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
