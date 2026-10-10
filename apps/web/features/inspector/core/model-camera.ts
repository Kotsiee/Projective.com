/**
 * model-camera — the pure camera maths behind the 3D canvas: where each named view looks from, how
 * far back the camera sits to frame a model, and how a view change eases between two directions.
 * No three.js and no DOM, so it is unit-tested and safe to import anywhere.
 */

// #region Vectors
/** A plain `[x, y, z]` triple. */
export type Vec3 = readonly [number, number, number];

function length(v: Vec3): number {
	return Math.hypot(v[0], v[1], v[2]);
}

/** `v` scaled to unit length; the zero vector stays zero. */
export function normalize(v: Vec3): Vec3 {
	const len = length(v);
	if (len === 0 || !Number.isFinite(len)) return [0, 0, 0];
	return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
// #endregion

// #region View presets
/** A named viewpoint around the model. */
export type ViewPreset = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";

/** One named view, with the key that jumps to it. */
export interface ViewPresetInfo {
	id: ViewPreset;
	label: string;
	key: string;
}

/** Every named view, in the order the panel lists them. */
export const VIEW_PRESETS: readonly ViewPresetInfo[] = [
	{ id: "front", label: "Front", key: "1" },
	{ id: "back", label: "Back", key: "2" },
	{ id: "left", label: "Left", key: "3" },
	{ id: "right", label: "Right", key: "4" },
	{ id: "top", label: "Top", key: "5" },
	{ id: "bottom", label: "Bottom", key: "6" },
	{ id: "iso", label: "Iso", key: "7" },
];

const POLE_OFFSET = 1e-4;

const DIRECTIONS: Readonly<Record<ViewPreset, Vec3>> = {
	front: [0, 0, 1],
	back: [0, 0, -1],
	left: [-1, 0, 0],
	right: [1, 0, 0],
	top: [0, 1, POLE_OFFSET],
	bottom: [0, -1, POLE_OFFSET],
	iso: [1, 0.8, 1],
};

/**
 * The unit direction from the orbit target to the camera for a named view (Y up). Top and bottom
 * lean a hair towards the front so the camera's up vector never lines up with its view direction.
 */
export function presetDirection(preset: ViewPreset): Vec3 {
	return normalize(DIRECTIONS[preset]);
}

/** The opening three-quarter view, a little above and to the right of the front. */
export const HOME_DIRECTION: Vec3 = normalize([0.6, 0.45, 1]);

/** The preset bound to a key, or `null`. */
export function presetForKey(key: string): ViewPreset | null {
	return VIEW_PRESETS.find((p) => p.key === key)?.id ?? null;
}
// #endregion

// #region Framing
/** Room left around a framed model, as a multiple of its bounding radius. */
export const FRAME_MARGIN = 1.15;

/**
 * How far from the centre a perspective camera must sit so a sphere of `radius` fits the view on
 * both axes. `fovDeg` is the vertical field of view; `aspect` is width / height.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
	const r = radius > 0 && Number.isFinite(radius) ? radius : 1;
	const halfV = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 360;
	const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
	const halfH = Math.atan(Math.tan(halfV) * safeAspect);
	return (r * FRAME_MARGIN) / Math.sin(Math.min(halfV, halfH));
}

/** Half extents of an orthographic frustum that fits a sphere of `radius` at the given aspect. */
export function orthoHalfExtents(
	radius: number,
	aspect: number,
): { halfWidth: number; halfHeight: number } {
	const r = (radius > 0 && Number.isFinite(radius) ? radius : 1) * FRAME_MARGIN;
	const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
	return safeAspect >= 1
		? { halfWidth: r * safeAspect, halfHeight: r }
		: { halfWidth: r, halfHeight: r / safeAspect };
}

/** Near and far clip planes that keep a model of `radius` sharp from `distance` out to a far zoom. */
export function clipPlanes(distance: number, radius: number): { near: number; far: number } {
	const r = radius > 0 && Number.isFinite(radius) ? radius : 1;
	const d = distance > 0 && Number.isFinite(distance) ? distance : r * 3;
	return { near: Math.max(r / 1000, d / 200), far: Math.max(d, r) * 200 };
}
// #endregion

// #region Transitions
/** How long an animated view change takes (skipped entirely under reduced motion). */
export const VIEW_TRANSITION_MS = 420;

/** Over-damped ease: fast start, no overshoot. */
export function easeOutCubic(t: number): number {
	const c = Math.max(0, Math.min(1, t));
	return 1 - (1 - c) ** 3;
}

/**
 * Spherical interpolation between two directions, returning a unit vector. Opposite directions
 * swing through a perpendicular so the path never passes through the target.
 */
export function slerpDirection(from: Vec3, to: Vec3, t: number): Vec3 {
	const a = normalize(from);
	const b = normalize(to);
	const c = Math.max(0, Math.min(1, t));
	const cos = Math.max(-1, Math.min(1, dot(a, b)));
	if (cos > 0.9995) {
		return normalize([
			a[0] + (b[0] - a[0]) * c,
			a[1] + (b[1] - a[1]) * c,
			a[2] + (b[2] - a[2]) * c,
		]);
	}
	if (cos < -0.9995) {
		const axis: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		const mid = normalize([
			a[1] * axis[2] - a[2] * axis[1],
			a[2] * axis[0] - a[0] * axis[2],
			a[0] * axis[1] - a[1] * axis[0],
		]);
		return c < 0.5 ? slerpDirection(a, mid, c * 2) : slerpDirection(mid, b, (c - 0.5) * 2);
	}
	const theta = Math.acos(cos);
	const sin = Math.sin(theta);
	const wa = Math.sin((1 - c) * theta) / sin;
	const wb = Math.sin(c * theta) / sin;
	return normalize([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
}

/** Linear interpolation between two scalars. */
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}
// #endregion

// #region Keyboard nudges
/** Orbit step for one arrow-key press, in radians. */
export const ORBIT_STEP = Math.PI / 24;

/** Dolly factor for one `+` / `-` press. */
export const DOLLY_STEP = 1.15;
// #endregion
