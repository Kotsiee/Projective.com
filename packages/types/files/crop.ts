import { z } from "zod";

/**
 * files.crop — the pure geometry of an aspect-locked crop, shared by the browser editor that DRAWS
 * it and the server pipeline that CUTS it.
 *
 * The editor shows a fixed crop box over a picture that can be panned, zoomed and rotated; the
 * server receives the same four numbers and re-derives the same box against the pixels it actually
 * decoded. One implementation, imported by both, is the only way "what you saw is what was saved"
 * holds — a second copy of this arithmetic is a crop that drifts by a few pixels on the server.
 *
 * ## The coordinate model
 *
 * The state is NOT "where the picture is on screen"; it is "which point of the picture sits at the
 * centre of the crop box" (`cx`, `cy`, in source pixels from the picture's centre), plus a zoom and
 * a rotation. Zoom and rotation both happen ABOUT the crop centre, so turning the dial never slides
 * the subject out of the middle of the box.
 *
 * ## The one invariant — the box is always entirely inside the picture
 *
 * No empty space inside a crop, ever. For an axis-aligned picture that reduces to a clean rule: a
 * rotated box lies inside the picture exactly when its AXIS-ALIGNED BOUNDING BOX does (the picture
 * is convex and axis-aligned, and a rotated rectangle's corners touch its bounding box). So:
 *
 *  - the LARGEST legal box at a rotation is the one whose bounding box just fits ({@link fitHeight});
 *    zoom 1 is that box, and zoom z shrinks it by z — so every zoom ≥ 1 is legal at every rotation,
 *    and rotating at a fixed zoom scales the picture up just enough to keep the box filled;
 *  - the legal crop CENTRES form an axis-aligned rectangle — the picture shrunk by the bounding
 *    box's half-extents ({@link centreBounds}).
 *
 * A square box at rotation 0 is exactly the old circular avatar cropper's fit (the short side spans
 * the box), so a rotation-free avatar crop behaves as it always did; the difference is that a rotated
 * avatar now stays FILLED instead of storing transparent corners.
 *
 * Every function is total: any input is clamped into a legal state rather than refused.
 */

// #region Types

/** The editor's state — see the module note for the coordinate model. */
export interface CropState {
	/** Multiplier over the FIT box (`1` = the largest box that fits at this rotation). */
	zoom: number;
	/** Degrees, clockwise (the CSS / canvas convention), in `(-180, 180]`. */
	rotation: number;
	/** The crop centre, in source pixels right of the picture's centre. */
	cx: number;
	/** The crop centre, in source pixels below the picture's centre. */
	cy: number;
}

/** The source picture's natural size, in pixels. */
export interface CropImage {
	width: number;
	height: number;
}

/** The transform the editor applies to the picture element (its box centred on the stage). */
export interface StageTransform {
	/** Offset of the picture's centre from the stage centre, in stage pixels. */
	tx: number;
	ty: number;
	/** Source pixel → stage pixel. */
	scale: number;
	/** Degrees, clockwise. */
	rotation: number;
}

// #endregion

// #region Constants + the request schema

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 6;
export const CROP_ROTATION_MIN = -180;
export const CROP_ROTATION_MAX = 180;

/** The state a freshly-opened picture starts in: the whole fit box, centred, unrotated. */
export const INITIAL_CROP: CropState = { zoom: 1, rotation: 0, cx: 0, cy: 0 };

/** Zoom multiplier per pixel of wheel travel (a 100px notch ≈ ×1.22 in, ×0.82 out). */
const WHEEL_ZOOM_PER_PX = 0.002;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

/**
 * The crop as it travels to the server. Bounded, but not trusted: the server clamps it again
 * against the picture it decoded ({@link clampCrop}), so an out-of-range centre from a crafted
 * request is corrected rather than obeyed.
 */
export const CropStateSchema = z.object({
	zoom: z.number().min(CROP_ZOOM_MIN).max(CROP_ZOOM_MAX),
	rotation: z.number().min(CROP_ROTATION_MIN).max(CROP_ROTATION_MAX),
	cx: z.number().min(-100_000).max(100_000),
	cy: z.number().min(-100_000).max(100_000),
});

// #endregion

// #region The box

/**
 * The height, in source pixels, of the LARGEST box of `aspect` (width ÷ height) whose bounding box
 * fits the picture at `rotation`. The two terms are the two axes: the box's bounding width
 * `|cos|·w + |sin|·h` must not exceed the picture's width, and its bounding height
 * `|sin|·w + |cos|·h` must not exceed its height, with `w = aspect·h`.
 */
export function fitHeight(image: CropImage, aspect: number, rotation: number): number {
	const a = positive(aspect, 1);
	const { cos, sin } = trig(rotation);
	const byWidth = safeDiv(positive(image.width, 1), cos * a + sin);
	const byHeight = safeDiv(positive(image.height, 1), sin * a + cos);
	return Math.max(1e-6, Math.min(byWidth, byHeight));
}

/** The crop box's size in source pixels at this state. */
export function cropBox(
	state: Pick<CropState, "zoom" | "rotation">,
	image: CropImage,
	aspect: number,
): { width: number; height: number } {
	const zoom = clamp(finite(state.zoom, 1), CROP_ZOOM_MIN, CROP_ZOOM_MAX);
	const height = fitHeight(image, aspect, state.rotation) / zoom;
	return { width: height * positive(aspect, 1), height };
}

/**
 * How far the crop centre may sit from the picture's centre on each axis, in source pixels: the
 * picture's half-size less the box's bounding half-extents. Exactly zero on the tight axis at zoom
 * 1 — the box then spans that axis and has nowhere to go. Never negative.
 */
export function centreBounds(
	state: Pick<CropState, "zoom" | "rotation">,
	image: CropImage,
	aspect: number,
): { x: number; y: number } {
	const box = cropBox(state, image, aspect);
	const { cos, sin } = trig(state.rotation);
	const ex = (cos * box.width + sin * box.height) / 2;
	const ey = (sin * box.width + cos * box.height) / 2;
	return {
		x: Math.max(0, positive(image.width, 1) / 2 - ex),
		y: Math.max(0, positive(image.height, 1) / 2 - ey),
	};
}

/** Wrap any angle into `(-180, 180]`. */
export function wrapRotation(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	let r = ((deg + 180) % 360 + 360) % 360 - 180;
	if (r === -180) r = 180;
	return r;
}

/** Clamp every field of a state into legality for this picture and aspect. Total — never throws. */
export function clampCrop(state: CropState, image: CropImage, aspect: number): CropState {
	const zoom = clamp(finite(state.zoom, 1), CROP_ZOOM_MIN, CROP_ZOOM_MAX);
	const rotation = wrapRotation(finite(state.rotation, 0));
	const bounds = centreBounds({ zoom, rotation }, image, aspect);
	return {
		zoom,
		rotation,
		cx: clamp(finite(state.cx, 0), -bounds.x, bounds.x),
		cy: clamp(finite(state.cy, 0), -bounds.y, bounds.y),
	};
}

// #endregion

// #region Editor transforms

/**
 * The CSS transform for the picture element — `translate(tx, ty) rotate(r) scale(s)` on a box
 * centred on the stage — that puts the crop centre exactly at the stage centre, with the crop box
 * filling a stage `stageWidth` pixels wide.
 */
export function stageTransform(
	state: CropState,
	image: CropImage,
	aspect: number,
	stageWidth: number,
): StageTransform {
	const box = cropBox(state, image, aspect);
	const scale = positive(stageWidth, 1) / box.width;
	const { x, y } = rotate(state.cx * scale, state.cy * scale, state.rotation);
	return { tx: -x, ty: -y, scale, rotation: state.rotation };
}

/**
 * The crop centre after the picture is dragged by `(dx, dy)` stage pixels. The picture follows the
 * pointer, so the point under the box's centre moves the OTHER way — by the pointer's travel,
 * un-rotated into the picture's frame and un-scaled into source pixels.
 */
export function dragCentre(
	state: CropState,
	image: CropImage,
	aspect: number,
	stageWidth: number,
	dx: number,
	dy: number,
): Pick<CropState, "cx" | "cy"> {
	const scale = stageTransform(state, image, aspect, stageWidth).scale;
	const { x, y } = rotate(dx / scale, dy / scale, -state.rotation);
	return { cx: state.cx - x, cy: state.cy - y };
}

/** The next zoom after a wheel notch; up (negative `deltaY`) zooms in. Clamped. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
	const px = deltaMode === 1
		? deltaY * WHEEL_LINE_PX
		: deltaMode === 2
		? deltaY * WHEEL_PAGE_PX
		: deltaY;
	return clamp(finite(zoom, 1) * Math.exp(-px * WHEEL_ZOOM_PER_PX), CROP_ZOOM_MIN, CROP_ZOOM_MAX);
}

// #endregion

// #region The server's cut

/**
 * The source point (absolute pixels, top-left origin) under a point of the OUTPUT, where `(u, v)` are
 * fractions across the crop box (`0,0` = its top-left corner, `1,1` = its bottom-right). This is the
 * inverse of what the editor draws: the box is fixed on the stage and the picture is rotated under
 * it, so a box offset maps into the picture by the OPPOSITE rotation.
 *
 * The server renders a crop by sampling the source at this point for every output pixel — one
 * resampling pass, with no intermediate rotated image.
 */
export function sourcePointFor(
	state: CropState,
	image: CropImage,
	aspect: number,
	u: number,
	v: number,
): { x: number; y: number } {
	const box = cropBox(state, image, aspect);
	const local = rotate((u - 0.5) * box.width, (v - 0.5) * box.height, -state.rotation);
	return {
		x: positive(image.width, 1) / 2 + state.cx + local.x,
		y: positive(image.height, 1) / 2 + state.cy + local.y,
	};
}

/**
 * Whether a state needs no rotation — the cut is then a plain rectangle copy with no resampling.
 * Only 0° qualifies: 180° is a double flip, which still moves every pixel.
 */
export function isAxisAligned(state: Pick<CropState, "rotation">): boolean {
	return Math.abs(wrapRotation(state.rotation)) < 1e-9;
}

// #endregion

// #region Helpers

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

function finite(n: number, fallback: number): number {
	return Number.isFinite(n) ? n : fallback;
}

function positive(n: number, fallback: number): number {
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function safeDiv(a: number, b: number): number {
	return b > 1e-12 ? a / b : Number.POSITIVE_INFINITY;
}

function trig(deg: number): { cos: number; sin: number } {
	const rad = (wrapRotation(deg) * Math.PI) / 180;
	return { cos: Math.abs(Math.cos(rad)), sin: Math.abs(Math.sin(rad)) };
}

/** Rotate `(x, y)` by `deg` clockwise in a y-down frame (the CSS / canvas convention). */
function rotate(x: number, y: number, deg: number): { x: number; y: number } {
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return { x: x * cos - y * sin, y: x * sin + y * cos };
}

// #endregion
