/**
 * @projective/ui/kanban — the board viewport's pure rules: how much horizontal travel a wheel event
 * asks for, how fast a drag held at an edge scrolls the board, and where the board settles once the
 * reader stops moving it. DOM-free so the gesture contract is pinned by test; the hook
 * (`hooks/useBoardViewport.ts`) only measures and writes.
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
/** Depth (px) of the zone at each inline edge where a held drag scrolls the board. */
export const EDGE_ZONE_PX = 80;
/** Auto-scroll speed (px/s) with the pointer at, or past, the board's edge. */
export const EDGE_MAX_SPEED = 1200;
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

/** One column as the settle measures it, in `scrollLeft` units. */
export interface SettleColumn {
	/** The `scrollLeft` that puts the column's left edge on the viewport's left content edge. */
	leftAt: number;
	width: number;
}

/**
 * Where the board settles after travel in `direction` (the sign of the last `scrollLeft` change; `0`
 * when unknown). Physical, so it reads the same in a right-to-left board:
 *
 * - **leftward** — the leftmost column still in view is brought flush to the left content edge;
 * - **rightward** — the rightmost column still in view is brought flush to the right content edge;
 * - **unknown** — the nearest column start ({@link snapTarget}).
 *
 * `view` is the viewport's content width (client width less inline padding). `null` when there is
 * nothing to do, on the same terms as {@link snapTarget}: no overflow, resting on an edge, or already
 * on the target.
 */
export function settleTarget(
	current: number,
	columns: readonly SettleColumn[],
	view: number,
	min: number,
	max: number,
	direction: -1 | 0 | 1,
): number | null {
	if (direction === 0) return snapTarget(current, columns.map((c) => c.leftAt), min, max);
	if (max - min < 1 || columns.length === 0) return null;
	if (current <= min + 1 || current >= max - 1) return null;
	const sorted = [...columns].sort((a, b) => a.leftAt - b.leftAt);
	let target: number | null = null;
	if (direction < 0) {
		const first = sorted.find((c) => c.leftAt + c.width > current + 0.5);
		if (first) target = first.leftAt;
	} else {
		const edge = current + view;
		const visible = sorted.filter((c) => c.leftAt < edge - 0.5);
		const last = visible[visible.length - 1];
		if (last) target = last.leftAt + last.width - view;
	}
	if (target === null) return null;
	const clamped = Math.min(max, Math.max(min, target));
	return Math.abs(clamped - current) < 0.5 ? null : clamped;
}
// #endregion

// #region Edge auto-scroll
/**
 * The board's auto-scroll velocity (px/s, negative leftward) for a drag whose pointer is at `x`, given
 * the scroller's left and right edges. Zero outside the edge zones; inside one it rises linearly with
 * depth to {@link EDGE_MAX_SPEED} at the edge and holds there past it. A narrow board shrinks the
 * zones to a quarter of its width each, so they never meet.
 */
export function edgeScrollVelocity(
	x: number,
	left: number,
	right: number,
	zone: number = EDGE_ZONE_PX,
	max: number = EDGE_MAX_SPEED,
): number {
	const width = right - left;
	if (width <= 0) return 0;
	const z = Math.min(zone, width / 4);
	if (z <= 0) return 0;
	if (x < left + z) return -max * Math.min(1, (left + z - x) / z);
	if (x > right - z) return max * Math.min(1, (x - (right - z)) / z);
	return 0;
}
// #endregion
