import type { CalendarWindow, IsoDate } from "@projective/types/scheduling";

/**
 * calendar-window — how much of a calendar one read covers, and around which day.
 *
 * Every calendar read is a WINDOW, not the whole axis: the engine scrolls ±19 years, and reading all of
 * that for every page view would be the whole schedule every time. The window is centred on the day
 * the reader asked for (`?around=`, which the island sends as its viewport moves), else on the page's
 * own `now`, and the page reports it (`CalendarWindow`) so the grid can say "Not loaded" past its edges
 * rather than drawing unread time as free (S-29).
 *
 * Pure: no clock, no IO.
 */

const DAY_MS = 86_400_000;

/** Which read a window is for. Each answers a different question, so each looks a different distance. */
export type CalendarReadKind = "personal" | "project" | "public";

/**
 * Days read either side of the anchor.
 *
 * - `personal` — the reader's own agenda, the union of every engagement they are on, so the widest
 *   fan-out per day read: two months back for context, six ahead for planning.
 * - `project` — one engagement, a far smaller read, whose stages run long: six months back, a year
 *   ahead.
 * - `public` — someone else's free/busy, whose ahead span stays inside the 120 days
 *   `scheduling.get_free_busy` answers from its `from`.
 */
export const CALENDAR_READ_DAYS: Readonly<
	Record<CalendarReadKind, { back: number; ahead: number }>
> = {
	personal: { back: 60, ahead: 180 },
	project: { back: 180, ahead: 365 },
	public: { back: 14, ahead: 90 },
};

/**
 * The instant a read is centred on: midday UTC of `around`, else `now`.
 *
 * Midday UTC rather than the reader's midnight because the zone is not known until the read has run.
 * The anchor need not fall inside the asked-for day in every zone, only the window around it must
 * cover that whole day, which a window of weeks either side does in every offset (−12 h to +14 h).
 */
export function windowAnchor(now: number, around?: IsoDate | null): number {
	return around ? Date.parse(`${around}T12:00:00.000Z`) : now;
}

/** The window one read covers, `[from, to)` epoch ms. */
export function calendarWindow(
	kind: CalendarReadKind,
	now: number,
	around?: IsoDate | null,
): CalendarWindow {
	const anchor = windowAnchor(now, around);
	const { back, ahead } = CALENDAR_READ_DAYS[kind];
	return { from: Math.max(0, anchor - back * DAY_MS), to: anchor + ahead * DAY_MS };
}
