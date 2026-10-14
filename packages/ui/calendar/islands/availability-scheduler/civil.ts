import type { Weekday } from "./types.ts";

// #region Minutes
/** Minutes in a civil day. */
export const DAY_MINUTES = 1440;

/** Clamp `n` into `[min, max]`. */
export function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/** Round `minute` to the nearest multiple of `snap`. */
export function snapTo(minute: number, snap: number): number {
	return Math.round(minute / snap) * snap;
}

/** `HH:MM`, with `1440` as `24:00`. */
export function fmtMinutes(minute: number): string {
	const h = Math.floor(minute / 60);
	const m = minute % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Parse `HH:MM` (00:00–24:00) to minutes, or `null`. */
export function parseMinutes(text: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
	if (!match) return null;
	const h = Number(match[1]);
	const m = Number(match[2]);
	if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
	return h * 60 + m;
}

/** A duration as "7h", "7h 30m" or "45m". */
export function fmtDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (!h) return `${m}m`;
	return m ? `${h}h ${m}m` : `${h}h`;
}
// #endregion

// #region Civil dates
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(iso: string): number {
	const match = ISO_RE.exec(iso);
	if (!match) throw new RangeError(`Not a civil date: ${iso}`);
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

function fromDayNumber(n: number): string {
	return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** True for a well-formed, real `YYYY-MM-DD`. */
export function isIsoDate(text: string): boolean {
	if (!ISO_RE.test(text)) return false;
	return fromDayNumber(dayNumber(text)) === text;
}

/** `iso` moved by `n` days. */
export function addDays(iso: string, n: number): string {
	return fromDayNumber(dayNumber(iso) + n);
}

/** The weekday of `iso`, 0 = Sunday. */
export function weekdayOf(iso: string): Weekday {
	return (((dayNumber(iso) % 7) + 11) % 7) as Weekday;
}

/** The first date of the week holding `iso`. */
export function startOfWeek(iso: string, weekStartsOn: number): string {
	return addDays(iso, -((weekdayOf(iso) - weekStartsOn + 7) % 7));
}

/** `YYYY-MM` of a date. */
export function monthOf(iso: string): string {
	return iso.slice(0, 7);
}

/** `YYYY-MM` moved by `n` months. */
export function addMonths(month: string, n: number): string {
	const [y, m] = month.split("-").map(Number);
	const index = y * 12 + (m - 1) + n;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The 42 dates (six whole weeks) a month grid shows. */
export function monthMatrix(month: string, weekStartsOn: number): string[] {
	const first = startOfWeek(`${month}-01`, weekStartsOn);
	return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** Today in `timezone`, as `YYYY-MM-DD`. */
export function todayIn(timezone: string, now = Date.now()): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	return `${get("year")}-${get("month")}-${get("day")}`;
}
// #endregion

// #region Weekday order
/** The seven weekdays in column order. */
export function weekColumns(weekStartsOn: number): Weekday[] {
	return Array.from({ length: 7 }, (_, i) => ((weekStartsOn + i) % 7) as Weekday);
}

/** The weekday one column to the left (`-1`) or right (`1`), or `null` past the week's edge. */
export function stepColumn(day: number, dir: -1 | 1, weekStartsOn: number): Weekday | null {
	const columns = weekColumns(weekStartsOn);
	const next = columns.indexOf(day as Weekday) + dir;
	return next < 0 || next > 6 ? null : columns[next];
}
// #endregion
