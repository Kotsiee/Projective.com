/**
 * @projective/ui/calendar — the zoom continuum as one number.
 *
 * Every calendar view is a depth on one axis, so a slider can drive all of them: a position `u` in
 * `[0, 1]` runs from the widest view (0) to the deepest (1) and is cut into equal ZONES, one per
 * {@link ZoomStop}. Inside a zone the position carries that view's own density — weeks on screen for
 * Month, pixels per hour for Week and Day, pixels per day for the Timeline — so dragging the handle
 * across a mark is exactly the view change Ctrl+wheel makes at the same threshold.
 *
 * Pure: no DOM, no signals, no clock.
 */
import { PX_PER_DAY_MAX, PX_PER_DAY_MIN } from "../../gantt/core/time-scale.ts";

// #region Vocabulary
/** Which axis the slider drives: the Day · Week · Month grids, or the Gantt timeline. */
export type CalendarZoomMode = "calendar" | "timeline";

/** One named zone of the slider, widest first. */
export type ZoomStop = "year" | "quarter" | "month" | "week" | "day";

/** The calendar axis, widest first. */
export const CALENDAR_STOPS: readonly ZoomStop[] = ["month", "week", "day"];
/** The timeline axis, widest first. */
export const TIMELINE_STOPS: readonly ZoomStop[] = ["year", "quarter", "month", "week", "day"];

/** The word each stop is shown and announced with. */
export const ZOOM_STOP_LABEL: Readonly<Record<ZoomStop, string>> = {
	year: "Year",
	quarter: "Quarter",
	month: "Month",
	week: "Week",
	day: "Day",
};
// #endregion

// #region Densities
/** The hour scale (px per hour) a timed view opens at. */
export const DEFAULT_PPH = 48;
/** The shallowest hour scale; zooming out past it leaves the view. */
export const MIN_PPH = 26;
/** The deepest hour scale; zooming in past it leaves the view. */
export const MAX_PPH = 168;
/** Week rows the Month view shows by default. */
export const MONTH_WEEKS_DEFAULT = 6;
/** The fewest week rows the Month view shows; zooming in past it opens the Week view. */
export const MONTH_WEEKS_MIN = 6;
/** The most week rows the Month view shows — the widest the calendar axis goes. */
export const MONTH_WEEKS_MAX = 10;

/**
 * The px-per-day edges between the timeline's stops, widest first: the scales at which the Gantt
 * header changes tier (`tierFor`), so the handle crosses a mark exactly where the header's rows do.
 */
export const TIMELINE_EDGES: readonly number[] = [PX_PER_DAY_MIN, 1.5, 6, 26, 300, PX_PER_DAY_MAX];
// #endregion

// #region Slider geometry
/**
 * How far inside a zone the deep end of a non-final zone sits from the next mark, so the zone's last
 * state maps to a position that still reads as that zone rather than as the next one's first.
 */
const EDGE_EPS = 1e-6;

/** The stops of an axis. */
export function stopsFor(mode: CalendarZoomMode): readonly ZoomStop[] {
	return mode === "timeline" ? TIMELINE_STOPS : CALENDAR_STOPS;
}

/** Where the marks between stops sit on the track, as positions in `(0, 1)`. */
export function zoomMarks(mode: CalendarZoomMode): number[] {
	const n = stopsFor(mode).length;
	return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

/** One ± step or Arrow press: a quarter of a zone, so every zone takes four steps to cross. */
export function zoomStep(mode: CalendarZoomMode): number {
	return 1 / (stopsFor(mode).length * 4);
}

/** The stop a position falls in. */
export function stopAt(mode: CalendarZoomMode, u: number): ZoomStop {
	const stops = stopsFor(mode);
	const i = Math.min(stops.length - 1, Math.max(0, Math.floor(clamp01(u) * stops.length)));
	return stops[i];
}

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** The zone index and the fraction travelled through it, for a position on an `n`-zone track. */
function zoneOf(u: number, n: number): { i: number; t: number } {
	const scaled = clamp01(u) * n;
	const i = Math.min(n - 1, Math.floor(scaled));
	return { i, t: scaled - i };
}

/** The position for a fraction `t` through zone `i` of an `n`-zone track. */
function positionOf(i: number, t: number, n: number): number {
	const inside = Math.max(0, Math.min(i === n - 1 ? 1 : 1 - EDGE_EPS, t));
	return (i + inside) / n;
}

/** `lo · (hi / lo)^t` — a log ramp, because every density here zooms by a factor per notch. */
function logLerp(lo: number, hi: number, t: number): number {
	return lo * Math.pow(hi / lo, t);
}

/** The inverse of {@link logLerp}, clamped to the ramp. */
function logFrac(lo: number, hi: number, v: number): number {
	if (!(v > 0)) return 0;
	return Math.max(0, Math.min(1, Math.log(v / lo) / Math.log(hi / lo)));
}
// #endregion

// #region Calendar axis
/** The view and densities one calendar position stands for. */
export interface CalendarZoomState {
	view: "day" | "week" | "month";
	/** Pixels per hour (Week and Day). */
	pph: number;
	/** Week rows on screen (Month). */
	weeks: number;
}

/** The position a calendar state sits at. */
export function calendarZoomFor(state: CalendarZoomState): number {
	const n = CALENDAR_STOPS.length;
	if (state.view === "month") {
		const weeks = Math.max(MONTH_WEEKS_MIN, Math.min(MONTH_WEEKS_MAX, state.weeks));
		return positionOf(0, (MONTH_WEEKS_MAX - weeks) / (MONTH_WEEKS_MAX - MONTH_WEEKS_MIN), n);
	}
	const i = state.view === "week" ? 1 : 2;
	return positionOf(i, logFrac(MIN_PPH, MAX_PPH, state.pph), n);
}

/** The calendar state a position stands for. */
export function calendarStateAt(u: number): CalendarZoomState {
	const { i, t } = zoneOf(u, CALENDAR_STOPS.length);
	if (i === 0) {
		return {
			view: "month",
			pph: MIN_PPH,
			weeks: MONTH_WEEKS_MAX - t * (MONTH_WEEKS_MAX - MONTH_WEEKS_MIN),
		};
	}
	return {
		view: i === 1 ? "week" : "day",
		pph: logLerp(MIN_PPH, MAX_PPH, t),
		weeks: MONTH_WEEKS_MIN,
	};
}

/** The position the calendar opens at: the Week view at its default hour scale. */
export const CALENDAR_ZOOM_DEFAULT = calendarZoomFor({
	view: "week",
	pph: DEFAULT_PPH,
	weeks: MONTH_WEEKS_DEFAULT,
});
// #endregion

// #region Timeline axis
/** The position a timeline scale (px per day) sits at. */
export function timelineZoomFor(pxPerDay: number): number {
	const n = TIMELINE_STOPS.length;
	const ppd = Math.max(TIMELINE_EDGES[0], Math.min(TIMELINE_EDGES[n], pxPerDay));
	let i = 0;
	while (i < n - 1 && ppd >= TIMELINE_EDGES[i + 1]) i++;
	return positionOf(i, logFrac(TIMELINE_EDGES[i], TIMELINE_EDGES[i + 1], ppd), n);
}

/** The timeline scale (px per day) a position stands for. */
export function timelinePxPerDayAt(u: number): number {
	const { i, t } = zoneOf(u, TIMELINE_STOPS.length);
	return logLerp(TIMELINE_EDGES[i], TIMELINE_EDGES[i + 1], t);
}
// #endregion
