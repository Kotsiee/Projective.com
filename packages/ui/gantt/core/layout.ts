/**
 * @projective/ui/gantt — the ROW GEOMETRY: where each lane sits on the vertical axis, where an item's
 * box lands inside it, and the pure hit test that turns a pointer back into the thing under it.
 *
 * The vertical axis is BOUNDED (rows) where the horizontal one is not (time), so it is plain row
 * arithmetic — with one wrinkle that is the whole reason this module exists rather than being three
 * multiplications inline: the HOVERED lane may be EXPANDED. A bar whose label was truncated grows its
 * row on hover to make room for the label and its meta line (§Part B "expands vertical lane height
 * dynamically if the label/metadata is truncated"), and every lane BELOW it shifts down by the same
 * amount. The canvas, the HTML task list and the hit test all read the same {@link RowGeometry}, so
 * a shifted row is shifted everywhere at once — and the DOM list gets it for free, because its rows
 * are in normal flow and the expanded one simply pushes its followers down.
 *
 * Content coordinates throughout: `y` grows from the top of the first lane, `x` from the axis origin.
 * The store's scroll offsets map them into the viewport.
 */
import { xOfMs } from "./time-scale.ts";
import type { GanttItem } from "./types.ts";

// #region Row geometry
/** The four numbers every vertical position is a function of. */
export interface RowGeometry {
	/** One un-expanded lane's height (px). */
	rowH: number;
	laneCount: number;
	/** The lane currently expanded on hover, or null. */
	hoverLane: number | null;
	/** How far (px) the hovered lane is expanded RIGHT NOW — a resolved number, never a target. */
	expandPx: number;
}

/** Content-space y of lane `i`'s top edge. */
export function laneTop(i: number, g: RowGeometry): number {
	const shift = g.hoverLane !== null && i > g.hoverLane ? g.expandPx : 0;
	return i * g.rowH + shift;
}

/** Lane `i`'s drawn height — the base row, plus the expansion when it is the hovered one. */
export function laneHeight(i: number, g: RowGeometry): number {
	return g.rowH + (i === g.hoverLane ? g.expandPx : 0);
}

/** The whole content's height — what the vertical scroll range is measured against. */
export function contentHeight(g: RowGeometry): number {
	return g.laneCount * g.rowH + (g.hoverLane !== null && g.laneCount > 0 ? g.expandPx : 0);
}

/**
 * The lane under content-space `y`, or null outside every row.
 *
 * Solved against the expansion rather than by dividing by the row height: below an expanded lane
 * the plain division is off by the expansion, which is exactly the region a reader hovering that
 * lane's neighbour would be pointing at.
 */
export function laneAtY(y: number, g: RowGeometry): number | null {
	if (g.laneCount <= 0 || g.rowH <= 0 || y < 0) return null;
	const naive = Math.floor(y / g.rowH);
	if (g.hoverLane === null || g.expandPx <= 0) {
		return naive < g.laneCount ? naive : null;
	}
	const hoverTop = g.hoverLane * g.rowH;
	if (y < hoverTop) return naive;
	if (y < hoverTop + g.rowH + g.expandPx) return g.hoverLane;
	const below = Math.floor((y - g.expandPx) / g.rowH);
	return below < g.laneCount ? below : null;
}

/**
 * The inclusive lane window intersecting a viewport, with `overscan` extra rows each side.
 * `last < first` means nothing is visible (no lanes at all).
 */
export function laneWindow(
	scrollY: number,
	viewportH: number,
	g: RowGeometry,
	overscan = 2,
): { first: number; last: number } {
	if (g.laneCount <= 0 || g.rowH <= 0) return { first: 0, last: -1 };
	const top = Math.max(0, scrollY);
	const bottom = top + Math.max(0, viewportH);
	const first = Math.max(0, (laneAtY(top, g) ?? g.laneCount - 1) - overscan);
	const lastIn = laneAtY(bottom, g);
	const last = Math.min(g.laneCount - 1, (lastIn ?? g.laneCount - 1) + overscan);
	return { first, last: Math.max(first, last) };
}
// #endregion

// #region Item boxes
/** A drawn item's box in CONTENT space, resolved from its lane and the live zoom. */
export interface ItemBox {
	id: string;
	laneIndex: number;
	x: number;
	y: number;
	w: number;
	h: number;
	milestone: boolean;
}

/** A bar narrower than this is still drawn this wide, so a one-hour item at a year zoom exists. */
export const MIN_BAR_PX = 4;
/** The smallest pointer target a bar is hit-tested as (WCAG 2.2 SC 2.5.8 leans on 24; a bar is short). */
export const BAR_HIT_MIN_PX = 12;
/** A milestone's pointer target — the diamond is small, the target is not. */
export const MILESTONE_HIT_PX = 24;

/**
 * Where an item is drawn.
 *
 * A bar keeps the base row's height whether or not its lane is expanded — the expansion is room for
 * TEXT beside the bar, not a taller bar — so the box a reader grabs does not change size under the
 * pointer that is hovering it.
 */
export function itemBox(
	item: Pick<GanttItem, "id" | "kind" | "start" | "end">,
	laneIndex: number,
	g: RowGeometry,
	originMs: number,
	pxPerDay: number,
	barInset: number,
	milestoneSize: number,
): ItemBox {
	const top = laneTop(laneIndex, g);
	if (item.kind === "milestone" || item.end <= item.start) {
		const size = Math.max(6, milestoneSize);
		return {
			id: item.id,
			laneIndex,
			x: xOfMs(item.start, originMs, pxPerDay) - size / 2,
			y: top + (g.rowH - size) / 2,
			w: size,
			h: size,
			milestone: true,
		};
	}
	const x0 = xOfMs(item.start, originMs, pxPerDay);
	const x1 = xOfMs(item.end, originMs, pxPerDay);
	const inset = Math.max(0, Math.min(barInset, g.rowH / 3));
	return {
		id: item.id,
		laneIndex,
		x: x0,
		y: top + inset,
		w: Math.max(MIN_BAR_PX, x1 - x0),
		h: Math.max(4, g.rowH - inset * 2),
		milestone: false,
	};
}

/** The box a pointer is tested against — the drawn box, widened to a usable target. */
export function hitBox(box: ItemBox): ItemBox {
	const minW = box.milestone ? MILESTONE_HIT_PX : BAR_HIT_MIN_PX;
	if (box.w >= minW) return box;
	const grow = (minW - box.w) / 2;
	return { ...box, x: box.x - grow, w: minW };
}

/** Whether a content-space point falls inside a box (edges inclusive). */
export function inBox(b: ItemBox, x: number, y: number): boolean {
	return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/**
 * The topmost item under a content-space point, or null.
 *
 * Walked from the LAST box back, because a later box is painted over an earlier one and the thing
 * the reader can see is the thing they are pointing at.
 */
export function hitTestItems(boxes: readonly ItemBox[], x: number, y: number): ItemBox | null {
	for (let i = boxes.length - 1; i >= 0; i--) {
		if (inBox(hitBox(boxes[i]), x, y)) return boxes[i];
	}
	return null;
}
// #endregion

// #region Dependency links
/** How far a link runs horizontally before it turns (px). */
export const LINK_ELBOW_PX = 12;

/**
 * The polyline a dependency link follows from the END of `from` to the START of `to`, as content
 * points. Successor to the right: out, down, in. Successor behind or overlapping: out, down to the
 * seam between the rows, back, down, in — so the line never crosses a bar it does not belong to.
 */
export function dependencyPath(from: ItemBox, to: ItemBox): { x: number; y: number }[] {
	const x1 = from.x + from.w;
	const y1 = from.y + from.h / 2;
	const x2 = to.x;
	const y2 = to.y + to.h / 2;
	const e = LINK_ELBOW_PX;
	if (x2 >= x1 + e * 2) {
		return [{ x: x1, y: y1 }, { x: x2 - e, y: y1 }, { x: x2 - e, y: y2 }, { x: x2, y: y2 }];
	}
	const seam = y1 < y2 ? from.y + from.h + (to.y - (from.y + from.h)) / 2 : y1 + (y2 - y1) / 2;
	return [
		{ x: x1, y: y1 },
		{ x: x1 + e, y: y1 },
		{ x: x1 + e, y: seam },
		{ x: x2 - e, y: seam },
		{ x: x2 - e, y: y2 },
		{ x: x2, y: y2 },
	];
}
// #endregion
