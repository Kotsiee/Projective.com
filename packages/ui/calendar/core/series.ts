/**
 * @projective/ui/calendar — what a multi-day selection becomes.
 *
 * A range dragged across several days is either ONE event spanning them (leave, a holiday) or a
 * DAILY series inside them (a stand-up at 9:30 every day). The range carries the days either way;
 * a daily one also carries the wall-clock times, and {@link dailyOccurrences} turns it into the
 * occurrences a host stores.
 *
 * Pure: no DOM, no signals, no clock.
 */
import type { CalendarDailyRepeat, CalendarRange } from "./types.ts";
import { addZonedDays, startOfDay, zonedParts, zonedTimeToMs } from "./time.ts";

/** The most days one selection may cover, so a runaway range cannot mint a runaway series. */
export const SERIES_MAX_DAYS = 366;

/** The repeat a daily choice opens on: 9:00 to 10:00. */
export const DAILY_REPEAT_DEFAULT: CalendarDailyRepeat = {
	startMinute: 9 * 60,
	endMinute: 10 * 60,
};

/** The midnight epochs of every day `range` touches, its end exclusive. */
export function rangeDays(range: CalendarRange, tz: string): number[] {
	const days: number[] = [];
	let d = startOfDay(range.start, tz);
	while (d < range.end && days.length < SERIES_MAX_DAYS) {
		days.push(d);
		d = addZonedDays(d, 1, tz);
	}
	return days.length > 0 ? days : [startOfDay(range.start, tz)];
}

/** Whether `range` covers more than one calendar day. */
export function isMultiDay(range: CalendarRange, tz: string): boolean {
	return rangeDays(range, tz).length > 1;
}

/** `dayMs` at `minute` minutes past its local midnight. */
function atMinute(dayMs: number, minute: number, tz: string): number {
	const p = zonedParts(dayMs, tz);
	return zonedTimeToMs(p.year, p.month, p.day, Math.floor(minute / 60), minute % 60, tz);
}

/**
 * The occurrences a range stands for: one timed range per day when it carries a {@link
 * CalendarRange.daily} repeat, otherwise the range itself.
 */
export function dailyOccurrences(range: CalendarRange, tz: string): CalendarRange[] {
	const repeat = range.daily;
	if (!repeat) return [{ start: range.start, end: range.end, allDay: range.allDay }];
	const startMinute = Math.max(0, Math.min(24 * 60 - 1, Math.round(repeat.startMinute)));
	const endMinute = Math.max(startMinute + 1, Math.min(24 * 60, Math.round(repeat.endMinute)));
	return rangeDays(range, tz).map((d) => ({
		start: atMinute(d, startMinute, tz),
		end: atMinute(d, endMinute, tz),
	}));
}

/** Minutes past local midnight of an instant. */
export function minuteOfDay(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return p.hour * 60 + p.minute;
}
