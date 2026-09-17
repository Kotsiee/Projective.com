/**
 * crop-model — the pure geometry of the avatar cropper: a circular viewport over a picture that can
 * be panned, zoomed and rotated, with the ONE invariant every gesture and control is clamped to —
 * the circle is always entirely inside the picture. No empty space inside the crop, ever.
 *
 * ## The coordinate model, and why the bounds are rectangles
 *
 * The state is NOT "where the picture is on the stage"; it is "which point of the picture sits at
 * the centre of the circle" (`cx`, `cy`, in source pixels from the picture's centre), plus a zoom
 * and a rotation. Two things fall out of choosing that as the state:
 *
 *  1. Zoom and rotation both happen ABOUT the crop centre, so turning the dial or the wheel never
 *     slides the subject away from the middle of the circle.
 *  2. A rotation maps a circle onto a circle, so "the circle lies inside the picture" is, in the
 *     picture's own frame, just "the circle's centre is at least one radius from every edge" — an
 *     axis-aligned rectangle of legal centres that does not change with rotation. Expressed in
 *     stage coordinates the same region would be a ROTATED rectangle, and two independent X/Y
 *     sliders cannot describe one. That is why the manual X/Y controls speak picture pixels.
 *
 * Everything below is total: any input is clamped into a legal state rather than refused.
 */

// #region Types
/** The cropper's state — see the module note for the coordinate model. */
export interface CropState {
	/** Multiplier over the FIT scale (`1` = the picture's short side exactly spans the circle). */
	zoom: number;
	/** Degrees, clockwise, in `(-180, 180]`. */
	rotation: number;
	/** The crop centre, in source pixels right of the picture's centre. */
	cx: number;
	/** The crop centre, in source pixels below the picture's centre. */
	cy: number;
}

/** The source picture's natural dimensions, in pixels. */
export interface CropImage {
	width: number;
	height: number;
}

/** The transform the stage applies to the picture element (its box centred on the stage). */
export interface StageTransform {
	/** Horizontal offset of the picture's centre from the stage centre, in stage pixels. */
	tx: number;
	/** Vertical offset, in stage pixels. */
	ty: number;
	/** Source pixel → stage pixel. */
	scale: number;
	/** Degrees, clockwise. */
	rotation: number;
}

/** The half-extents of the legal crop centre, in source pixels; `0` pins that axis. */
export interface CentreBounds {
	x: number;
	y: number;
}
// #endregion

// #region Constants
export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 4;
export const CROP_ROTATION_MIN = -180;
export const CROP_ROTATION_MAX = 180;
/** The square the cropper exports, in pixels — generous for a 72px avatar, small enough to hold. */
export const CROP_OUTPUT_PX = 512;
/** Zoom multiplier per pixel of wheel travel (a 100px notch ≈ ×1.22 in, ×0.82 out). */
const WHEEL_ZOOM_PER_PX = 0.002;
/** Pixels one `deltaMode` line / page stands for, for wheels that report in those units. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

export const INITIAL_CROP: CropState = { zoom: 1, rotation: 0, cx: 0, cy: 0 };
// #endregion

// #region Scale + bounds
/** The scale at which the picture's SHORT side exactly spans the circle — the smallest legal zoom. */
export function fitScale(image: CropImage, diameter: number): number {
	const short = Math.min(image.width, image.height);
	return short > 0 ? diameter / short : 1;
}

/** Source pixel → stage pixel at the given zoom. */
export function viewScale(image: CropImage, diameter: number, zoom: number): number {
	return fitScale(image, diameter) * clamp(zoom, CROP_ZOOM_MIN, CROP_ZOOM_MAX);
}

/**
 * How far the crop centre may sit from the picture's centre on each axis, in source pixels. Exactly
 * zero on the short axis at zoom 1 — the circle then spans that axis edge to edge and has nowhere to
 * go — and it grows with the zoom. Never negative: a scale below fit is not a legal state.
 */
export function centreBounds(image: CropImage, diameter: number, zoom: number): CentreBounds {
	const scale = viewScale(image, diameter, zoom);
	const radius = diameter / 2 / scale;
	return {
		x: Math.max(0, image.width / 2 - radius),
		y: Math.max(0, image.height / 2 - radius),
	};
}

/** Wrap any angle into `(-180, 180]`. */
export function wrapRotation(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	let r = ((deg + 180) % 360 + 360) % 360 - 180;
	if (r === -180) r = 180;
	return r;
}

/** Clamp every field of a state into legality for this picture. Total — never throws. */
export function clampState(state: CropState, image: CropImage, diameter: number): CropState {
	const zoom = clamp(finite(state.zoom, 1), CROP_ZOOM_MIN, CROP_ZOOM_MAX);
	const bounds = centreBounds(image, diameter, zoom);
	return {
		zoom,
		rotation: wrapRotation(finite(state.rotation, 0)),
		cx: clamp(finite(state.cx, 0), -bounds.x, bounds.x),
		cy: clamp(finite(state.cy, 0), -bounds.y, bounds.y),
	};
}
// #endregion

// #region Transforms
/**
 * The CSS transform for the picture element — `translate(tx, ty) rotate(r) scale(s)` on a box
 * centred on the stage — that puts the crop centre exactly at the stage centre.
 */
export function stageTransform(
	state: CropState,
	image: CropImage,
	diameter: number,
): StageTransform {
	const scale = viewScale(image, diameter, state.zoom);
	const { x, y } = rotate(state.cx * scale, state.cy * scale, state.rotation);
	return { tx: -x, ty: -y, scale, rotation: state.rotation };
}

/**
 * The crop centre after the picture is dragged by `(dx, dy)` stage pixels. The picture follows the
 * pointer, so the point under the circle's centre moves the OTHER way — and by the pointer's travel
 * un-rotated back into the picture's frame and un-scaled into source pixels.
 */
export function dragCentre(
	state: CropState,
	image: CropImage,
	diameter: number,
	dx: number,
	dy: number,
): Pick<CropState, "cx" | "cy"> {
	const scale = viewScale(image, diameter, state.zoom);
	const { x, y } = rotate(dx / scale, dy / scale, -state.rotation);
	return { cx: state.cx - x, cy: state.cy - y };
}

/**
 * The manual offset controls: how far the PICTURE has been moved, in source pixels — positive moves
 * it right / down at zero rotation — which is the crop centre's offset negated. Inverse of
 * {@link centreFromOffset}.
 */
export function offsetOf(state: Pick<CropState, "cx" | "cy">): { x: number; y: number } {
	return { x: -state.cx, y: -state.cy };
}

export function centreFromOffset(x: number, y: number): Pick<CropState, "cx" | "cy"> {
	return { cx: -x, cy: -y };
}

/** The next zoom after a wheel notch; up (negative `deltaY`) zooms in. Clamped. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
	const px = deltaMode === 1
		? deltaY * WHEEL_LINE_PX
		: deltaMode === 2
		? deltaY * WHEEL_PAGE_PX
		: deltaY;
	return clamp(zoom * Math.exp(-px * WHEEL_ZOOM_PER_PX), CROP_ZOOM_MIN, CROP_ZOOM_MAX);
}

/**
 * The canvas operations that draw the crop into a `size`×`size` square: `translate(size/2)` ·
 * `rotate(rotation)` · `scale(scale)` · `translate(-cx, -cy)` · draw the picture centred on the
 * origin. The scale is the stage scale re-expressed for the output square, so the exported picture
 * shows exactly what the circle showed.
 */
export function exportTransform(
	state: CropState,
	image: CropImage,
	diameter: number,
	size = CROP_OUTPUT_PX,
): { scale: number; rotation: number; cx: number; cy: number } {
	const scale = viewScale(image, diameter, state.zoom) * (size / diameter);
	return { scale, rotation: state.rotation, cx: state.cx, cy: state.cy };
}
// #endregion

// #region Helpers
function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

function finite(n: number, fallback: number): number {
	return Number.isFinite(n) ? n : fallback;
}

/** Rotate `(x, y)` by `deg` clockwise in a y-down frame (the CSS / canvas convention). */
function rotate(x: number, y: number, deg: number): { x: number; y: number } {
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return { x: x * cos - y * sin, y: x * sin + y * cos };
}
// #endregion
