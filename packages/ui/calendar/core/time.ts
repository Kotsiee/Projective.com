/**
 * @projective/ui/calendar — pure time-matrix utilities. Every function is deterministic given an
 * explicit IANA `timeZone`, so the SSR render and the hydrated island resolve identical positions
 * (no hydration drift). Times are epoch **milliseconds (UTC)** throughout; a "zoned" value is that
 * instant read through a timezone's wall clock via `Intl.DateTimeFormat` (available on both Deno and
 * the browser). Positions inside a day are computed from ELAPSED ms against the day's real midnight
 * epoch, so 23h/25h DST days render proportionally.
 */

// #region Constants
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_NARROW = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAYS_LONG = [
	"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
// #endregion

// #region Timezone core
/** Resolve the viewer's own IANA timezone, degrading to UTC where `Intl` is unavailable. */
export function localTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** Wall-clock components of `ms` read through `tz`. `month` is 1-based. */
export interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
	let f = partsFmtCache.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		partsFmtCache.set(tz, f);
	}
	return f;
}

/** Read the wall-clock components of an instant through a timezone. */
export function zonedParts(ms: number, tz: string): ZonedParts {
	const map: Record<string, string> = {};
	for (const p of partsFmt(tz).formatToParts(new Date(ms))) {
		if (p.type !== "literal") map[p.type] = p.value;
	}
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		hour: Number(map.hour === "24" ? "0" : map.hour),
		minute: Number(map.minute),
		second: Number(map.second),
	};
}

/** The tz offset (ms) at an instant: `Date.UTC(zonedParts) - ms`. */
function offsetAt(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

/** The epoch ms of a wall-clock time (`y`/`m`(1-based)/`d` `h`:`min`) in `tz`. DST-corrected. */
export function zonedTimeToMs(
	y: number,
	m: number,
	d: number,
	h: number,
	min: number,
	tz: string,
): number {
	const guess = Date.UTC(y, m - 1, d, h, min, 0);
	const off1 = offsetAt(guess, tz);
	let epoch = guess - off1;
	const off2 = offsetAt(epoch, tz);
	if (off2 !== off1) epoch = guess - off2;
	return epoch;
}
// #endregion

// #region Day / week / month matrix
/** Epoch ms of local midnight of the day containing `ms` (in `tz`). */
export function startOfDay(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return zonedTimeToMs(p.year, p.month, p.day, 0, 0, tz);
}

/** Add `n` calendar days, preserving the wall-clock time (DST-safe day arithmetic). */
export function addZonedDays(ms: number, n: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return zonedTimeToMs(p.year, p.month, p.day + n, p.hour, p.minute, tz);
}

/** Add `n` calendar months, clamping the day to the target month's length. */
export function addZonedMonths(ms: number, n: number, tz: string): number {
	const p = zonedParts(ms, tz);
	const total = (p.month - 1) + n;
	const year = p.year + Math.floor(total / 12);
	const month = ((total % 12) + 12) % 12 + 1;
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return zonedTimeToMs(year, month, Math.min(p.day, last), p.hour, p.minute, tz);
}

/** 0 = Sunday … 6 = Saturday for the zoned calendar date of `ms`. */
export function zonedWeekday(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Epoch ms of local midnight at the start of the week containing `ms`. */
export function startOfWeek(ms: number, tz: string, weekStartsOn = 1): number {
	const dow = zonedWeekday(ms, tz);
	const diff = (dow - weekStartsOn + 7) % 7;
	return addZonedDays(startOfDay(ms, tz), -diff, tz);
}

/** The 7 day-midnight epochs of the week containing `ms`. */
export function weekDays(ms: number, tz: string, weekStartsOn = 1): number[] {
	const start = startOfWeek(ms, tz, weekStartsOn);
	return Array.from({ length: 7 }, (_, i) => addZonedDays(start, i, tz));
}

/** The 42 day-midnight epochs (6 weeks) of the month grid containing `ms`. */
export function monthMatrix(ms: number, tz: string, weekStartsOn = 1): number[] {
	const p = zonedParts(ms, tz);
	const first = zonedTimeToMs(p.year, p.month, 1, 0, 0, tz);
	const gridStart = startOfWeek(first, tz, weekStartsOn);
	return Array.from({ length: 42 }, (_, i) => addZonedDays(gridStart, i, tz));
}

/** Whether two instants fall on the same zoned calendar day. */
export function sameZonedDay(a: number, b: number, tz: string): boolean {
	const pa = zonedParts(a, tz);
	const pb = zonedParts(b, tz);
	return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Whether `ms` falls in the same zoned month as `ref`. */
export function sameZonedMonth(ms: number, ref: number, tz: string): boolean {
	const a = zonedParts(ms, tz);
	const b = zonedParts(ref, tz);
	return a.year === b.year && a.month === b.month;
}

/** Elapsed minutes from a day's real midnight epoch to `ms` (DST-proportional). */
export function minutesFromDayStart(ms: number, dayStart: number): number {
	return (ms - dayStart) / MIN;
}
// #endregion

// #region Formatters (all timezone-explicit → SSR == client)
const timeFmtCache = new Map<string, Intl.DateTimeFormat>();
function timeFmt(tz: string, hour12: boolean): Intl.DateTimeFormat {
	const key = `${tz}|${hour12}`;
	let f = timeFmtCache.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hour: "numeric",
			minute: "2-digit",
			hour12,
		});
		timeFmtCache.set(key, f);
	}
	return f;
}

/** `2:30 PM` (or `14:30`) — the wall-clock time of `ms` in `tz`. */
export function fmtTime(ms: number, tz: string, hour12 = true): string {
	return timeFmt(tz, hour12).format(new Date(ms));
}

/** An hour-gutter label for `hour` (0–23), e.g. `2 PM` / `14:00` / `12 AM`. */
export function fmtHourLabel(hour: number, hour12 = true): string {
	const h = ((hour % 24) + 24) % 24;
	if (!hour12) return `${h.toString().padStart(2, "0")}:00`;
	if (h === 0) return "12 AM";
	if (h === 12) return "12 PM";
	return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** `July 2026` — the month + year of `ms` in `tz`. */
export function fmtMonthYear(ms: number, tz: string): string {
	const p = zonedParts(ms, tz);
	return `${MONTHS_LONG[p.month - 1]} ${p.year}`;
}

/** `Jul 2026` (short month). */
export function fmtMonthYearShort(ms: number, tz: string): string {
	const p = zonedParts(ms, tz);
	return `${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** `Thu, Jul 17` — a short weekday + day. */
export function fmtDayLabel(ms: number, tz: string): string {
	const p = zonedParts(ms, tz);
	return `${WEEKDAYS_SHORT[zonedWeekday(ms, tz)]}, ${MONTHS_SHORT[p.month - 1]} ${p.day}`;
}

/** `Thursday, July 17, 2026` — a long, full date. */
export function fmtFullDate(ms: number, tz: string): string {
	const p = zonedParts(ms, tz);
	return `${WEEKDAYS_LONG[zonedWeekday(ms, tz)]}, ${MONTHS_LONG[p.month - 1]} ${p.day}, ${p.year}`;
}

/** The day-of-month number (1–31) of `ms` in `tz`. */
export function zonedDayNum(ms: number, tz: string): number {
	return zonedParts(ms, tz).day;
}

/** Weekday header labels (Sun-first index) — `short` (Mon) or `narrow` (M). */
export function weekdayLabels(narrow = false, weekStartsOn = 1): string[] {
	const src = narrow ? WEEKDAYS_NARROW : WEEKDAYS_SHORT;
	return Array.from({ length: 7 }, (_, i) => src[(i + weekStartsOn) % 7]);
}

/** A compact `2:30 – 3:45 PM` range label for an event. */
export function fmtRange(start: number, end: number, tz: string, hour12 = true): string {
	return `${fmtTime(start, tz, hour12)} – ${fmtTime(end, tz, hour12)}`;
}
// #endregion
