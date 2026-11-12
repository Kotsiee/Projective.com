import type { CalendarWindow, IsoDate } from "@projective/types/scheduling";
import { viewSpan } from "@ui/calendar/core/coverage.ts";
import { DAY } from "@ui/calendar/core/time.ts";
import type { CalendarViewMode } from "@ui/calendar/core/types.ts";
import { focusDate } from "./calendar-address.ts";

/**
 * window-reach — when a calendar island reads its next window (S-29).
 *
 * A page holds one window of events (`CalendarWindow`). The island reads the window around the
 * reader's focus when the period on screen leaves it, and a little before, so that ordinary scrolling
 * never shows "Not loaded" at all: the margin is how far ahead of an edge the next read starts. The
 * server sizes every window, so this decides only WHEN to read and around which day.
 *
 * Pure: no DOM, no signals, no clock.
 */

/** Days of lead before a window's edge at which the next read starts, by how far a view travels. */
export const READ_LEAD_DAYS: Readonly<Record<CalendarViewMode, number>> = {
	day: 14,
	week: 14,
	month: 28,
	timeline: 60,
};

/**
 * The day to read around next, or `null` when the window already reaches far enough — or when the
 * last read was around that same day, which is how a window narrower than the lead (a public page's
 * fortnight back) settles instead of reading the same span again and again.
 */
export function nextReadAround(
	window: CalendarWindow | undefined,
	view: CalendarViewMode,
	focus: number,
	tz: string,
	lastAround: IsoDate | null,
): IsoDate | null {
	if (!window) return null;
	const span = viewSpan(view, focus, tz);
	const lead = Math.min(READ_LEAD_DAYS[view] * DAY, (window.to - window.from) / 4);
	if (window.from <= span.start - lead && span.end + lead <= window.to) return null;
	const around = focusDate(focus, tz);
	return around === lastAround ? null : around;
}
