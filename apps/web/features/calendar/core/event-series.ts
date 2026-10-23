import type { CalendarEvent } from "@projective/types/scheduling";
import { dailyOccurrences, minuteOfDay } from "@ui/calendar/core/series.ts";
import type { CalendarRange } from "@ui/calendar/core/types.ts";

/**
 * event-series — what a composer commit becomes on a calendar body.
 *
 * A range the reader asked for as a DAILY series is one occurrence per day; anything else is one
 * event. Entries are minted through the caller's factory (`blankEvent`) so a series is made of the
 * same blank entries the full modal starts from, and this module stays free of the modal stack.
 */

/** Mint one blank entry over a range. */
export type MintEvent = (range: CalendarRange) => CalendarEvent;

/** The entries one quick-create commits: one per occurrence of a daily range, else one. */
export function eventsForRange(
	range: CalendarRange,
	title: string,
	tz: string,
	mint: MintEvent,
): CalendarEvent[] {
	return dailyOccurrences(range, tz).map((occurrence) => ({ ...mint(occurrence), title }));
}

/** The range the full modal opens a daily selection on: its first occurrence. */
export function firstOccurrence(range: CalendarRange, tz: string): CalendarRange {
	return dailyOccurrences(range, tz)[0];
}

/**
 * Lay an edited first occurrence onto every day of its daily series at the edit's own time of day
 * and length, so a time changed in the full modal moves the whole series with it.
 */
export function spreadDaily(
	event: CalendarEvent,
	series: CalendarRange,
	tz: string,
): CalendarEvent[] {
	const startMinute = Math.min(24 * 60 - 1, minuteOfDay(event.start, tz));
	const length = Math.max(0, event.end - event.start);
	const starts = dailyOccurrences(
		{ ...series, daily: { startMinute, endMinute: startMinute + 1 } },
		tz,
	);
	return starts.map((o, i) => ({
		...event,
		id: i === 0 ? event.id : `${event.id}-${i}`,
		start: o.start,
		end: o.start + length,
	}));
}
