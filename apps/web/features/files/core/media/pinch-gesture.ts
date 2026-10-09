/**
 * pinch-gesture — the pure arithmetic of a two-finger gesture on the crop stage: pan by the
 * centroid's travel, zoom by the ratio of finger spreads, rotate by the change in the line between
 * the fingers. All three are read from the same pair of samples, so they apply together.
 */

// #region Types

export interface PointerPoint {
	x: number;
	y: number;
}

/** One sample of two fingers: their midpoint, spread and bearing. */
export interface PinchFrame {
	cx: number;
	cy: number;
	/** Euclidean distance between the fingers, in CSS pixels. */
	distance: number;
	/** `atan2(y₂ − y₁, x₂ − x₁)`, in degrees, clockwise in a y-down frame. */
	angle: number;
}

/** What moved between two frames. */
export interface PinchDelta {
	dx: number;
	dy: number;
	/** Multiply the zoom by this. `1` when either spread is degenerate. */
	scale: number;
	/** Add this to the rotation, in degrees, in `(-180, 180]`. */
	rotation: number;
}

// #endregion

// #region Geometry

/** The midpoint, spread and bearing of two fingers. */
export function pinchFrame(a: PointerPoint, b: PointerPoint): PinchFrame {
	return {
		cx: (a.x + b.x) / 2,
		cy: (a.y + b.y) / 2,
		distance: Math.hypot(b.x - a.x, b.y - a.y),
		angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
	};
}

/** The pan, zoom factor and rotation one frame of a two-finger gesture is worth. */
export function pinchDelta(prev: PinchFrame, next: PinchFrame): PinchDelta {
	const usable = prev.distance > 1 && next.distance > 1;
	return {
		dx: next.cx - prev.cx,
		dy: next.cy - prev.cy,
		scale: usable ? next.distance / prev.distance : 1,
		rotation: usable ? wrapDelta(next.angle - prev.angle) : 0,
	};
}

function wrapDelta(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	const r = ((deg + 180) % 360 + 360) % 360 - 180;
	return r === -180 ? 180 : r;
}

// #endregion
