/**
 * @projective/ui/kanban — the board viewport's pure rules: how much horizontal travel a wheel event
 * asks for, and which column start the board settles on once the reader stops moving it. DOM-free so
 * the gesture contract is pinned by test; the hook (`hooks/useBoardViewport.ts`) only measures and
 * writes.
 *
 * @module
 */

// #region Constants
/** A `deltaMode: line` wheel notch, in px — the calendar and Gantt viewports use the same box. */
export const WHEEL_LINE_PX = 16;
/** How long the wheel must be idle before the board settles on a column. */
export const SNAP_IDLE_MS = 140;
/** Pointer travel (px) that turns a pan press into a pan rather than a click. */
export const PAN_THRESHOLD_PX = 4;
// #endregion

// #region Wheel
/** The fields of a `WheelEvent` the board reads. */
export interface BoardWheel {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	shiftKey: boolean;
}

/** A wheel delta in px, whatever unit the device reported it in. */
export function wheelPixels(delta: number, deltaMode: number, pagePx: number): number {
	if (deltaMode === 1) return delta * WHEEL_LINE_PX;
	if (deltaMode === 2) return delta * pagePx;
	return delta;
}

/**
 * The `scrollLeft` change a wheel event asks of the board, applied 1:1 so a burst of events reads as
 * one continuous glide rather than a queue of eased steps.
 *
 * The larger axis is the intent. A horizontal swipe is physical (`deltaX > 0` moves right in either
 * direction); a vertical turn — and Shift+wheel, which some platforms leave vertical — travels the
 * inline axis, so in a right-to-left board it decreases `scrollLeft`.
 */
export function boardWheelDelta(e: BoardWheel, pagePx: number, rtl: boolean): number {
	const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
	if (horizontal) return wheelPixels(e.deltaX, e.deltaMode, pagePx);
	const inline = wheelPixels(e.deltaY, e.deltaMode, pagePx);
	return rtl ? -inline : inline;
}

/** Whether a vertical wheel over a column body belongs to that column's own scroll, not the board's. */
export function wheelStaysInColumn(e: BoardWheel, columnScrollable: boolean): boolean {
	return columnScrollable && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX);
}
// #endregion

// #region Snap
/**
 * Where the board settles once the reader lets go: the column start nearest `current`, clamped into
 * `[min, max]`. `null` when there is nothing to do — no overflow, already resting on an edge (the
 * reader scrolled there on purpose and the last column may not start on a snap point), or already on
 * the target.
 */
export function snapTarget(
	current: number,
	starts: readonly number[],
	min: number,
	max: number,
): number | null {
	if (max - min < 1 || starts.length === 0) return null;
	if (current <= min + 1 || current >= max - 1) return null;
	let best = starts[0];
	for (const s of starts) {
		if (Math.abs(s - current) < Math.abs(best - current)) best = s;
	}
	const target = Math.min(max, Math.max(min, best));
	return Math.abs(target - current) < 0.5 ? null : target;
}
// #endregion
