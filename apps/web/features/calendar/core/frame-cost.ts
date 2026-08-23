/**
 * frame-cost — a development-only recorder for the calendar canvas's per-frame cost.
 *
 * WHY THIS EXISTS. This repo's renderer policy is TIERED (root CLAUDE.md §8 Decision #1: D3/SVG →
 * Canvas2D → PIXI/WebGL, "auto-selected on a performance metric"), so "is Canvas2D still the right
 * tier for the calendar" has to be settled by a measurement rather than by whoever argues hardest.
 * The engine reports each frame through `CalendarProps.onFrame`; this collects a rolling window and
 * summarises it.
 *
 * WHY IT LIVES IN THE APP AND NOT THE PACKAGE. `packages/ui` has no `IS_DEV` and must not acquire
 * one — depending on the app's build constants would end the copy-paste portability that is the
 * whole point of that package. So the engine's side is a plain optional callback that costs one
 * `undefined` check, and the DEV-ONLY half is here, behind {@link IS_DEV}, which Vite replaces
 * statically so the recorder and its buffer leave the production bundle entirely.
 *
 * WHAT THE NUMBERS DO AND DO NOT MEAN. `drawMs` is the cost of the paint pass itself, not
 * composite-to-screen latency; a browser that never presents the frame (a hidden tab) still reports
 * an honest draw time. Treat it as the renderer's own budget, and confirm anything marginal in a
 * visible window before acting on it.
 */

import type { FrameStats } from "@projective/ui/calendar";
import { IS_DEV } from "@web/utils/dev.ts";

// #region Contract
/** A summary over the recorded window. All times in ms. */
export interface FrameSummary {
	count: number;
	p50: number;
	p95: number;
	max: number;
	/** The most recent frame's scene shape — what the renderer was actually asked to draw. */
	shapes: number;
	textRuns: number;
	eventsInScene: number;
	eventsTotal: number | null;
	columns: number;
	width: number;
	height: number;
	dpr: number;
}

/** The handle published for measurement. */
export interface FrameRecorder {
	record: (stats: FrameStats) => void;
	stats: () => FrameSummary | null;
	reset: () => void;
}
// #endregion

// #region Recorder
/**
 * How many frames to keep.
 *
 * A window rather than a running mean: a mean over a long session hides the thing worth seeing,
 * which is the tail. 240 frames is a few seconds of continuous interaction — long enough for a p95
 * to mean something, short enough that it reflects what is on screen NOW rather than a scroll from
 * a minute ago.
 */
const WINDOW = 240;

function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) return 0;
	// Nearest-rank: with a few hundred samples, interpolating between neighbours implies a precision
	// the sample size does not have.
	const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
	return sorted[i];
}

function createRecorder(): FrameRecorder {
	let times: number[] = [];
	let last: FrameStats | null = null;

	return {
		record(stats) {
			last = stats;
			times.push(stats.drawMs);
			if (times.length > WINDOW) times = times.slice(-WINDOW);
		},
		stats() {
			if (!last || times.length === 0) return null;
			const sorted = [...times].sort((a, b) => a - b);
			const round = (n: number) => Math.round(n * 1000) / 1000;
			return {
				count: times.length,
				p50: round(quantile(sorted, 0.5)),
				p95: round(quantile(sorted, 0.95)),
				max: round(sorted[sorted.length - 1]),
				shapes: last.shapes,
				textRuns: last.textRuns,
				eventsInScene: last.eventsInScene,
				eventsTotal: last.eventsTotal,
				columns: last.columns,
				width: last.width,
				height: last.height,
				dpr: last.dpr,
			};
		},
		reset() {
			times = [];
			last = null;
		},
	};
}

/**
 * The recorder for this document, or `null` outside development.
 *
 * Also published on `globalThis.__pjCalendarFrames` so the numbers can be read from a console or a
 * driving harness without wiring a panel for something that exists to answer one architectural
 * question. Returning `null` in production is what makes the whole module tree-shakeable.
 */
export function frameRecorder(): FrameRecorder | null {
	if (!IS_DEV || typeof globalThis === "undefined") return null;
	const host = globalThis as { __pjCalendarFrames?: FrameRecorder };
	if (!host.__pjCalendarFrames) host.__pjCalendarFrames = createRecorder();
	return host.__pjCalendarFrames;
}

/**
 * The `onFrame` callback to hand the engine, or `undefined` in production.
 *
 * Deliberately `undefined` rather than a no-op: an absent callback is the branch the engine treats
 * as "nobody is measuring", so it never reads the clock or counts the scene at all.
 */
export function frameProbe(): ((stats: FrameStats) => void) | undefined {
	const rec = frameRecorder();
	return rec ? rec.record : undefined;
}
// #endregion
