/**
 * Pure geometry for {@link ScrollRail} (`islands/ScrollRail.tsx`): which edges still hide items, how
 * far one arrow press travels, and what a wheel turn over the rail asks for. No DOM, so the thresholds
 * are unit-tested without a layout engine.
 */

// #region Edges
/** The measured scroll box of a rail's track, in CSS pixels. */
export interface RailMetrics {
	/** `scrollLeft`: zero at the start, negative toward the end in a right-to-left track. */
	scrollLeft: number;
	clientWidth: number;
	scrollWidth: number;
}

/** Which ends of the track still hide items. */
export interface RailEdges {
	back: boolean;
	forward: boolean;
}

/** Sub-pixel slack between a fractional scroll offset and a rounded scroll extent. */
export const EDGE_SLACK_PX = 1;

/** Whether items are hidden behind each end. Direction-blind: a right-to-left offset is read by size. */
export function railEdges(m: RailMetrics): RailEdges {
	const offset = Math.abs(m.scrollLeft);
	const hidden = m.scrollWidth - m.clientWidth;
	if (hidden <= EDGE_SLACK_PX) return { back: false, forward: false };
	return {
		back: offset > EDGE_SLACK_PX,
		forward: offset < hidden - EDGE_SLACK_PX,
	};
}
// #endregion

// #region Paging
/**
 * How far one arrow press scrolls: the whole items that fit, less one, so the item cut at the edge
 * stays on screen as the anchor of the next view. A rail whose items cannot be measured pages by
 * 80% of the viewport instead.
 */
export function railPage(viewport: number, pitch: number): number {
	if (viewport <= 0) return 0;
	if (pitch <= 0) return Math.round(viewport * 0.8);
	const whole = Math.floor(viewport / pitch);
	return Math.max(1, whole - 1) * pitch;
}
// #endregion

// #region Wheel
/** The slice of a `WheelEvent` the rail reads. */
export interface RailWheel {
	deltaX: number;
	deltaY: number;
	/** `0` pixels · `1` lines · `2` pages, as `WheelEvent.deltaMode`. */
	deltaMode: number;
	ctrlKey: boolean;
}

/** Pixels one wheel line stands for when the device reports lines. */
export const WHEEL_LINE_PX = 16;

/**
 * The horizontal scroll a vertical wheel turn over the rail asks for, or `0` to leave the event to
 * the page: a sideways gesture (the track scrolls itself), a pinch-zoom, or a turn toward an end that
 * is already reached, so the page keeps scrolling once the rail has nowhere left to go.
 */
export function railWheelDelta(
	wheel: RailWheel,
	edges: RailEdges,
	rtl: boolean,
	viewport: number,
): number {
	if (wheel.ctrlKey || Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX)) return 0;
	const unit = wheel.deltaMode === 1 ? WHEEL_LINE_PX : wheel.deltaMode === 2 ? viewport : 1;
	const along = wheel.deltaY * unit;
	if (along > 0 && !edges.forward) return 0;
	if (along < 0 && !edges.back) return 0;
	return rtl ? -along : along;
}
// #endregion
