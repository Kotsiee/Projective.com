/**
 * @projective/ui/calendar — whether the period on screen has been READ.
 *
 * A host's events cover a window, not the axis (`CalendarProps.loaded`). An empty grid outside that
 * window would read as free time, which is the one thing it is not known to be, so the engine asks
 * this whether the focused period is covered and says "Not loaded" over it when it is not.
 *
 * Pure: no DOM, no signals, no clock.
 */
import type { CalendarViewMode } from "./types.ts";
import { addZonedDays, monthMatrix, startOfDay, startOfWeek } from "./time.ts";

/** A span of time, epoch ms, `[start, end)`. */
export interface CoverageSpan {
	start: number;
	end: number;
}

/**
 * The span a view shows around `focusMs`: its day, its week, the six weeks of its month grid, or for
 * the Timeline the week it is centred on — the least that is always on screen there.
 */
export function viewSpan(view: CalendarViewMode, focusMs: number, tz: string): CoverageSpan {
	if (view === "day") {
		const start = startOfDay(focusMs, tz);
		return { start, end: addZonedDays(start, 1, tz) };
	}
	if (view === "month") {
		const days = monthMatrix(focusMs, tz);
		return { start: days[0], end: addZonedDays(days[days.length - 1], 1, tz) };
	}
	const start = startOfWeek(focusMs, tz);
	return { start, end: addZonedDays(start, 7, tz) };
}

/** Whether `span` lies wholly inside `loaded`. With nothing said about coverage, everything is. */
export function spanLoaded(span: CoverageSpan, loaded: CoverageSpan | null | undefined): boolean {
	return !loaded || (loaded.start <= span.start && span.end <= loaded.end);
}
