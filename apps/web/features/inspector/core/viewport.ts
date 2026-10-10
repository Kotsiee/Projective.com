/**
 * viewport — the pure arithmetic of the image canvas: fitting a picture to the stage, zooming about
 * a point, panning within bounds, quarter-turn rotation and on-screen mirroring, two-finger gestures
 * and the CSS transform that draws the result.
 *
 * Coordinates are stage pixels. The picture is laid out at its natural size, centred on the stage;
 * the state moves its centre by (x, y), turns it, mirrors it and scales it. No DOM.
 */

// #region Types
/** A width and height in pixels. */
export interface Size {
	width: number;
	height: number;
}

/** A position in stage pixels, measured from the stage's top-left corner. */
export interface Point {
	x: number;
	y: number;
}

/** Where and how the picture is drawn. */
export interface ViewportState {
	/** Display scale: `1` draws one image pixel per CSS pixel. */
	zoom: number;
	/** Offset of the picture's centre from the stage's centre. */
	x: number;
	y: number;
	/** Clockwise degrees, a multiple of 90, accumulated so a transition turns the short way. */
	rotation: number;
	/** Mirrored left↔right on screen. */
	flipX: boolean;
	/** Mirrored top↔bottom on screen. */
	flipY: boolean;
}

/** The smallest and largest display scale the stage allows. */
export interface ZoomLimits {
	min: number;
	max: number;
}

/** What a viewport operation needs to know about the stage and the picture. */
export interface ViewportFrame {
	container: Size;
	natural: Size;
	limits: ZoomLimits;
}

/** How {@link fit} sizes the picture. */
export interface FitOptions {
	/** Enlarge a picture smaller than the stage (vector art); bitmaps stop at 100%. */
	upscale?: boolean;
	/** Clear space kept around the fitted picture, in pixels. */
	gutter?: number;
}

/** The picture's on-screen box, in stage pixels. */
export interface Bounds {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** An on-screen mirror axis. */
export type FlipAxis = "horizontal" | "vertical";

/** A rotation reduced to one turn. */
export type QuarterTurn = 0 | 90 | 180 | 270;
// #endregion

// #region Constants
/** Lower zoom bound, as a fraction of the fitted (or 100%) scale. */
export const ZOOM_MIN_FACTOR = 0.05;
/** Upper zoom bound, as a multiple of the fitted (or 100%) scale. */
export const ZOOM_MAX_FACTOR = 32;
/** Clear space around a fitted picture. */
export const FIT_GUTTER = 16;
/** One zoom-in step (buttons and keys). */
export const ZOOM_STEP = 1.25;
/** Positions on the logarithmic zoom slider. */
export const ZOOM_SLIDER_STEPS = 1000;

/** The untransformed picture. */
export const VIEWPORT_IDENTITY: Readonly<ViewportState> = Object.freeze({
	zoom: 1,
	x: 0,
	y: 0,
	rotation: 0,
	flipX: false,
	flipY: false,
});

const LINE_PX = 16;
const PAGE_PX = 400;
const WHEEL_MAX_PX = 200;
const WHEEL_RATE = 0.0015;
const PINCH_RATE = 0.01;
// #endregion

// #region Geometry
/** A rotation in degrees reduced to the nearest quarter turn in `[0, 360)`. */
export function quarterTurn(deg: number): QuarterTurn {
	if (!Number.isFinite(deg)) return 0;
	const turned = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
	return turned as QuarterTurn;
}

/** The picture's box after rotation: a quarter or three-quarter turn swaps its sides. */
export function rotatedSize(natural: Size, rotation: number): Size {
	const turn = quarterTurn(rotation);
	return turn === 90 || turn === 270
		? { width: natural.height, height: natural.width }
		: { width: natural.width, height: natural.height };
}

/** The display scale that fits the (rotated) picture inside the stage. */
export function fit(
	container: Size,
	natural: Size,
	rotation: number,
	opts: FitOptions = {},
): number {
	const box = rotatedSize(natural, rotation);
	if (!(box.width > 0) || !(box.height > 0)) return 1;
	const gutter = Math.max(0, opts.gutter ?? FIT_GUTTER);
	const room = (side: number) => (side > gutter * 4 ? side - gutter * 2 : side);
	const scale = Math.min(room(container.width) / box.width, room(container.height) / box.height);
	if (!Number.isFinite(scale) || scale <= 0) return 1;
	return opts.upscale ? scale : Math.min(1, scale);
}

/** The zoom range for a fitted scale: always reaches both the fit and 100%. */
export function zoomLimits(fitZoom: number): ZoomLimits {
	const base = Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1;
	return {
		min: Math.min(base, 1) * ZOOM_MIN_FACTOR,
		max: Math.max(base, 1) * ZOOM_MAX_FACTOR,
	};
}

/** A zoom kept inside its limits. */
export function clampZoom(zoom: number, limits: ZoomLimits): number {
	if (!Number.isFinite(zoom)) return limits.min;
	return Math.min(limits.max, Math.max(limits.min, zoom));
}

/** The picture's on-screen size at the state's zoom and rotation. */
export function displayedSize(state: ViewportState, natural: Size): Size {
	const box = rotatedSize(natural, state.rotation);
	return { width: box.width * state.zoom, height: box.height * state.zoom };
}

/** The picture's on-screen box. */
export function imageBounds(state: ViewportState, container: Size, natural: Size): Bounds {
	const shown = displayedSize(state, natural);
	return {
		left: container.width / 2 + state.x - shown.width / 2,
		top: container.height / 2 + state.y - shown.height / 2,
		width: shown.width,
		height: shown.height,
	};
}

/** Whether the picture is larger than the stage on either axis, so dragging moves it. */
export function canPan(state: ViewportState, container: Size, natural: Size): boolean {
	const shown = displayedSize(state, natural);
	return shown.width > container.width + 0.5 || shown.height > container.height + 0.5;
}

/**
 * The box the rule-of-thirds guide covers: the drawn picture's on-screen bounds (rotation applied),
 * snapped to whole stage pixels so the guide's lines stay crisp. `null` before anything is drawn.
 */
export function thirdsBox(state: ViewportState, container: Size, natural: Size): Bounds | null {
	if (natural.width <= 0 || natural.height <= 0) return null;
	if (container.width <= 0 || container.height <= 0) return null;
	const b = imageBounds(state, container, natural);
	const left = Math.round(b.left);
	const top = Math.round(b.top);
	const width = Math.round(b.left + b.width) - left;
	const height = Math.round(b.top + b.height) - top;
	return width > 0 && height > 0 ? { left, top, width, height } : null;
}
// #endregion

// #region Operations
/**
 * Keep the picture covering the stage on each axis it overflows, and centred on each axis it does
 * not, so it can never be dragged out of view.
 */
export function clampPan(state: ViewportState, container: Size, natural: Size): ViewportState {
	const shown = displayedSize(state, natural);
	const limitX = Math.max(0, (shown.width - container.width) / 2);
	const limitY = Math.max(0, (shown.height - container.height) / 2);
	const x = Math.min(limitX, Math.max(-limitX, state.x));
	const y = Math.min(limitY, Math.max(-limitY, state.y));
	return x === state.x && y === state.y ? state : { ...state, x: x || 0, y: y || 0 };
}

/** The state fitted to the stage, keeping its rotation and mirroring. */
export function fitView(
	state: ViewportState,
	container: Size,
	natural: Size,
	opts: FitOptions = {},
): ViewportState {
	return { ...state, zoom: fit(container, natural, state.rotation, opts), x: 0, y: 0 };
}

/** Scale by `factor` about a stage point, which stays under the cursor (or fingers). */
export function zoomAt(
	state: ViewportState,
	point: Point,
	factor: number,
	frame: ViewportFrame,
): ViewportState {
	const zoom = clampZoom(
		state.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1),
		frame.limits,
	);
	const ratio = zoom / state.zoom;
	const px = point.x - frame.container.width / 2;
	const py = point.y - frame.container.height / 2;
	const next: ViewportState = {
		...state,
		zoom,
		x: px - (px - state.x) * ratio,
		y: py - (py - state.y) * ratio,
	};
	return clampPan(next, frame.container, frame.natural);
}

/** Set an exact zoom about a stage point (the stage centre when `point` is null). */
export function zoomTo(
	state: ViewportState,
	zoom: number,
	point: Point | null,
	frame: ViewportFrame,
): ViewportState {
	const at = point ?? { x: frame.container.width / 2, y: frame.container.height / 2 };
	return zoomAt(state, at, clampZoom(zoom, frame.limits) / state.zoom, frame);
}

/** Move the picture by a stage-pixel delta, within bounds. */
export function panBy(
	state: ViewportState,
	dx: number,
	dy: number,
	frame: ViewportFrame,
): ViewportState {
	return clampPan({ ...state, x: state.x + dx, y: state.y + dy }, frame.container, frame.natural);
}

/**
 * Turn the view a quarter clockwise (`1`) or counter-clockwise (`-1`) on screen, about the stage
 * centre. While the picture is mirrored once, the stored turn runs the other way so the screen
 * still turns the direction asked for.
 */
export function rotateBy(state: ViewportState, turns: 1 | -1): ViewportState {
	const mirrored = state.flipX !== state.flipY;
	const step = (mirrored ? -turns : turns) * 90;
	const x = turns === 1 ? -state.y : state.y;
	const y = turns === 1 ? state.x : -state.x;
	return { ...state, rotation: state.rotation + step, x: x || 0, y: y || 0 };
}

/** Mirror the view across a screen axis, about the stage centre. */
export function flip(state: ViewportState, axis: FlipAxis): ViewportState {
	return axis === "horizontal"
		? { ...state, flipX: !state.flipX, x: -state.x || 0 }
		: { ...state, flipY: !state.flipY, y: -state.y || 0 };
}

/** Whether the state shows the picture exactly fitted and centred. */
export function isFitted(state: ViewportState, fitZoom: number): boolean {
	return Math.abs(state.zoom - fitZoom) < 1e-4 && Math.abs(state.x) < 0.5 &&
		Math.abs(state.y) < 0.5;
}
// #endregion

// #region CSS
/**
 * The picture's mirroring in its own (pre-rotation) frame. A screen mirror applied after a quarter
 * turn is the other axis of the picture.
 */
export function imageFlips(state: ViewportState): { sx: 1 | -1; sy: 1 | -1 } {
	const turn = quarterTurn(state.rotation);
	const sideways = turn === 90 || turn === 270;
	const mirrorX = sideways ? state.flipY : state.flipX;
	const mirrorY = sideways ? state.flipX : state.flipY;
	return { sx: mirrorX ? -1 : 1, sy: mirrorY ? -1 : 1 };
}

function num(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

function scaleNum(value: number): string {
	return String(Number(value.toPrecision(6)));
}

/** The CSS transform for a picture laid out at natural size, centred on the stage. */
export function toCss(state: ViewportState): string {
	const { sx, sy } = imageFlips(state);
	return `translate(${num(state.x)}px, ${num(state.y)}px) rotate(${num(state.rotation)}deg) ` +
		`scale(${scaleNum(state.zoom * sx)}, ${scaleNum(state.zoom * sy)})`;
}
// #endregion

// #region Input
/**
 * The zoom factor for one wheel event, exponential in the scrolled distance and normalised for
 * `deltaMode` (pixels, lines, pages). A trackpad pinch (`pinch`) arrives as small, frequent deltas.
 */
export function wheelFactor(deltaY: number, deltaMode = 0, pinch = false): number {
	if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
	const unit = deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1;
	const px = Math.max(-WHEEL_MAX_PX, Math.min(WHEEL_MAX_PX, deltaY * unit));
	return Math.exp(-px * (pinch ? PINCH_RATE : WHEEL_RATE));
}

/** Two fingers: their midpoint, spread and bearing (degrees, clockwise in a y-down frame). */
export interface PinchFrame {
	cx: number;
	cy: number;
	distance: number;
	angle: number;
}

/** What moved between two {@link PinchFrame}s. */
export interface PinchDelta {
	dx: number;
	dy: number;
	/** Multiply the zoom by this; `1` when either spread is degenerate. */
	scale: number;
	/** Twist in degrees, in `(-180, 180]`. */
	rotation: number;
}

/** Sample two pointers as a {@link PinchFrame}. */
export function pinchFrame(a: Point, b: Point): PinchFrame {
	return {
		cx: (a.x + b.x) / 2,
		cy: (a.y + b.y) / 2,
		distance: Math.hypot(b.x - a.x, b.y - a.y),
		angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
	};
}

/** The pan, zoom factor and twist between two samples of the same two fingers. */
export function pinchDelta(prev: PinchFrame, next: PinchFrame): PinchDelta {
	const usable = prev.distance > 1 && next.distance > 1;
	return {
		dx: next.cx - prev.cx,
		dy: next.cy - prev.cy,
		scale: usable ? next.distance / prev.distance : 1,
		rotation: usable ? wrapDegrees(next.angle - prev.angle) : 0,
	};
}

/** The quarter turns a finished two-finger twist snaps to (a twist under 45° is no turn). */
export function snapTwist(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	return Math.trunc((Math.abs(deg) + 45) / 90) * Math.sign(deg);
}

function wrapDegrees(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	const r = ((deg + 180) % 360 + 360) % 360 - 180;
	return r === -180 ? 180 : r;
}
// #endregion

// #region Labels
/** A zoom as a whole percentage of natural size, never below 1%. */
export function zoomPercent(zoom: number): string {
	if (!Number.isFinite(zoom) || zoom <= 0) return "0%";
	return `${Math.max(1, Math.round(zoom * 100))}%`;
}

/** Where a zoom sits on the logarithmic slider, `0..ZOOM_SLIDER_STEPS`. */
export function sliderPosition(zoom: number, limits: ZoomLimits): number {
	const span = Math.log(limits.max / limits.min);
	if (!(span > 0)) return 0;
	const at = Math.log(clampZoom(zoom, limits) / limits.min) / span;
	return Math.round(at * ZOOM_SLIDER_STEPS);
}

/** The zoom at a logarithmic slider position. */
export function sliderZoom(position: number, limits: ZoomLimits): number {
	const at = Math.min(ZOOM_SLIDER_STEPS, Math.max(0, position)) / ZOOM_SLIDER_STEPS;
	return clampZoom(limits.min * Math.pow(limits.max / limits.min, at), limits);
}

function gcd(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y > 0) [x, y] = [y, x % y];
	return x;
}

/** A width:height ratio in small whole terms (`16:9`), or to two decimals (`1.91:1`). */
export function aspectRatioLabel(width: number, height: number): string | null {
	if (!(width > 0) || !(height > 0)) return null;
	const w = Math.round(width);
	const h = Math.round(height);
	const d = gcd(w, h) || 1;
	if (w / d <= 32 && h / d <= 32) return `${w / d}:${h / d}`;
	return `${(width / height).toFixed(2)}:1`;
}
// #endregion
