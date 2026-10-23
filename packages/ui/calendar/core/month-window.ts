/**
 * @projective/ui/calendar — the arithmetic of the continuous Month view.
 *
 * The view is one column of weeks with no first or last row. A row is addressed by its offset from an
 * ORIGIN week (the Monday-midnight epoch the grid mounted on), so row `r` is the week starting
 * `addZonedDays(origin, 7r)` — DST-safe, because the days are added on the zoned calendar rather than
 * as milliseconds. A scroll position is a fractional row: the row at the top of the viewport.
 *
 * Pure: no DOM, no signals, no clock.
 */
import { addZonedDays, DAY, startOfDay, startOfWeek, zonedParts, zonedTimeToMs } from "./time.ts";

const WEEK = 7 * DAY;

/** The first day (midnight epoch) of row `row`. */
export function weekStartOf(origin: number, row: number, tz: string): number {
	return addZonedDays(origin, 7 * row, tz);
}

/** The row holding `dayMs`. Rounded, because a DST change shifts a week by an hour, never by a day. */
export function rowOfDay(origin: number, dayMs: number, tz: string): number {
	return Math.round((startOfWeek(dayMs, tz) - origin) / WEEK);
}

/** The seven day-midnight epochs of row `row`. */
export function daysOfRow(origin: number, row: number, tz: string): number[] {
	const start = weekStartOf(origin, row, tz);
	return Array.from({ length: 7 }, (_, i) => addZonedDays(start, i, tz));
}

/** The midnight epoch of the first day of the month holding `ms`. */
export function monthStartOf(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return zonedTimeToMs(p.year, p.month, 1, 0, 0, tz);
}

/** The scroll position that frames `ms`'s month: the week holding its first day at the top. */
export function frameRow(origin: number, ms: number, tz: string): number {
	return rowOfDay(origin, monthStartOf(ms, tz), tz);
}

/** The scroll position that centres `dayMs`'s week in a viewport `weeks` rows tall, snapped. */
export function centerRow(origin: number, dayMs: number, weeks: number, tz: string): number {
	return rowOfDay(origin, dayMs, tz) - Math.floor((Math.max(1, Math.round(weeks)) - 1) / 2);
}

/** The months the window starting at `top` shows, and which of them it is ABOUT. */
export interface MonthWindow {
	/** The first day (midnight epoch) of the focal month: the one with the most days on screen. */
	focal: number;
	/** The first day on screen that belongs to the focal month — what the window reports as focus. */
	anchor: number;
}

/**
 * The focal month of the window `[top, top + weeks)`: the month with the most of its days on
 * screen. The other months' days are the ones the grid mutes. A tie goes to the month holding the
 * window's centre day, which is the one a reader is looking at.
 */
export function monthWindow(origin: number, top: number, weeks: number, tz: string): MonthWindow {
	const rows = Math.max(1, Math.round(weeks));
	const counts = new Map<number, { count: number; first: number }>();
	const days: number[] = [];
	for (let r = 0; r < rows; r++) days.push(...daysOfRow(origin, top + r, tz));
	for (const d of days) {
		const p = zonedParts(d, tz);
		const key = p.year * 12 + p.month - 1;
		const hit = counts.get(key);
		if (hit) hit.count++;
		else counts.set(key, { count: 1, first: d });
	}
	const centre = zonedParts(days[Math.floor(days.length / 2)], tz);
	const centreKey = centre.year * 12 + centre.month - 1;
	let bestKey = centreKey;
	let best = counts.get(centreKey)?.count ?? 0;
	for (const [key, { count }] of counts) {
		if (count > best) {
			best = count;
			bestKey = key;
		}
	}
	const anchor = counts.get(bestKey)?.first ?? days[0];
	return { focal: monthStartOf(anchor, tz), anchor: startOfDay(anchor, tz) };
}
