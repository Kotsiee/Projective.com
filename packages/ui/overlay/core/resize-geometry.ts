/**
 * DraggablePopover resize arithmetic — the pure half of an edge or corner drag.
 *
 * Geometry is expressed on the LOGICAL axes the panel is positioned on (`inset-inline-start` /
 * `inset-block-start`), so a grip's inline offset is measured from the inline-start edge in either
 * reading direction. The caller converts screen travel with `inlineDelta` before calling in.
 *
 * @module
 */

import { clampSize, usedPx } from "../../editor/core/resize.ts";

// #region Grips
/**
 * A resize grip, named by the logical side(s) it sits on. Corners read block-then-inline, as in
 * `border-start-end-radius`: `start-end` is the block-start / inline-end corner.
 */
export type ResizeGrip =
	| "block-start"
	| "start-end"
	| "inline-end"
	| "end-end"
	| "block-end"
	| "end-start"
	| "inline-start"
	| "start-start";

/** Which edge of an axis a grip moves: `-1` the start edge, `1` the end edge, `0` neither. */
export type EdgeSign = -1 | 0 | 1;

/** Every grip, clockwise from block-start in a left-to-right document. */
export const RESIZE_GRIPS: readonly ResizeGrip[] = [
	"block-start",
	"start-end",
	"inline-end",
	"end-end",
	"block-end",
	"end-start",
	"inline-start",
	"start-start",
];

/** The edge each grip moves on each axis. An edge grip leaves its cross axis alone. */
export const GRIP_EDGES: Readonly<Record<ResizeGrip, { inline: EdgeSign; block: EdgeSign }>> = {
	"block-start": { inline: 0, block: -1 },
	"start-end": { inline: 1, block: -1 },
	"inline-end": { inline: 1, block: 0 },
	"end-end": { inline: 1, block: 1 },
	"block-end": { inline: 0, block: 1 },
	"end-start": { inline: -1, block: 1 },
	"inline-start": { inline: -1, block: 0 },
	"start-start": { inline: -1, block: -1 },
};
// #endregion

// #region Geometry
/** A panel box in viewport px: start offsets on each axis plus the border-box size. */
export interface ResizeRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The size range a resize may produce, in px. `Infinity` is a legitimate max and means no ceiling. */
export interface ResizeBounds {
	minW: number;
	minH: number;
	maxW: number;
	maxH: number;
}

/** Signed pointer travel on each logical axis, in px. */
export interface ResizeDelta {
	inline: number;
	block: number;
}

/** One axis of a box: where it starts and how long it is. */
export interface AxisSpan {
	start: number;
	size: number;
}

/** The constraints one axis of a resize is held to. */
export interface AxisLimits {
	min: number;
	max: number;
	viewport: number;
	margin: number;
}

/** The computed size constraints a resize reads (a `CSSStyleDeclaration` satisfies it). */
export interface SizeConstraintStyle {
	minWidth: string;
	minHeight: string;
	maxWidth: string;
	maxHeight: string;
}

/**
 * Read resize bounds from a computed style, floored at the caller's own minimums.
 *
 * A consumer's `min-*`/`max-*` override is honoured because it is read from the cascade, not
 * restated here; an unset `max-*` reads `none` and becomes no ceiling.
 */
export function resizeBounds(
	style: SizeConstraintStyle,
	floor: { w: number; h: number },
): ResizeBounds {
	return {
		minW: Math.max(floor.w, usedPx(style.minWidth, 0)),
		minH: Math.max(floor.h, usedPx(style.minHeight, 0)),
		maxW: usedPx(style.maxWidth, Infinity),
		maxH: usedPx(style.maxHeight, Infinity),
	};
}

/**
 * Resolve one axis of a resize.
 *
 * The opposite edge never moves, so a start-edge drag shifts `start` by exactly the size it adds or
 * removes, and the floor winning over every ceiling is what stops the box inverting. The moving edge
 * stops `margin` short of the viewport, unless it began beyond that line: it may then shrink back but
 * never travel further out, and it is not yanked inward on the first move.
 */
export function resizeAxis(
	span: AxisSpan,
	delta: number,
	edge: EdgeSign,
	limits: AxisLimits,
): AxisSpan {
	if (edge === 0) return span;
	const end = span.start + span.size;
	if (edge === 1) {
		const room = Math.max(limits.viewport - limits.margin, end) - span.start;
		return {
			start: span.start,
			size: clampSize(span.size + delta, limits.min, Math.min(limits.max, room)),
		};
	}
	const room = end - Math.min(limits.margin, span.start);
	const size = clampSize(span.size - delta, limits.min, Math.min(limits.max, room));
	return { start: end - size, size };
}

/** The box a grip produces after `delta` of travel from `start`. */
export function resizeRect(
	start: ResizeRect,
	grip: ResizeGrip,
	delta: ResizeDelta,
	bounds: ResizeBounds,
	viewport: { w: number; h: number },
	margin: number,
): ResizeRect {
	const edges = GRIP_EDGES[grip];
	const inline = resizeAxis({ start: start.x, size: start.w }, delta.inline, edges.inline, {
		min: bounds.minW,
		max: bounds.maxW,
		viewport: viewport.w,
		margin,
	});
	const block = resizeAxis({ start: start.y, size: start.h }, delta.block, edges.block, {
		min: bounds.minH,
		max: bounds.maxH,
		viewport: viewport.h,
		margin,
	});
	return { x: inline.start, y: block.start, w: inline.size, h: block.size };
}
// #endregion
