import { wrapRotation } from "@projective/types/files";

/**
 * rotation-ruler — the pure geometry of the crop editor's infinite rotation ruler.
 *
 * The ruler is a strip of degree ticks that rolls under a fixed centre needle. Its offset is the
 * angle taken modulo a full turn, `Δx = (θ mod 360) × pixelsPerDegree`, and the ticks are generated
 * only for the window in view, so the strip never runs out in either direction — 359° rolls into 0°
 * exactly as 0° rolls into 1°.
 */

// #region Constants

/** Ruler travel per degree, in CSS pixels. */
export const RULER_PX_PER_DEGREE = 6;
/** Degrees per keyboard step, and per Shift / PageUp step. */
export const RULER_STEP = 1;
export const RULER_STEP_LARGE = 15;
/** Degrees per pixel of wheel travel. */
const WHEEL_DEG_PER_PX = 0.05;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

// #endregion

// #region Types

/** One tick in view: `x` is its offset from the needle, in pixels. */
export interface RulerTick {
	/** The tick's degree on the unwrapped strip — unique within one render, so a stable key. */
	key: number;
	x: number;
	tier: "minor" | "mid" | "major";
	/** The wrapped angle printed under a major tick, or `null`. */
	label: string | null;
}

// #endregion

// #region Geometry

/** `θ mod 360` in `[0, 360)`. */
export function turnAngle(theta: number): number {
	if (!Number.isFinite(theta)) return 0;
	return ((theta % 360) + 360) % 360;
}

/** The strip's offset under the needle: `(θ mod 360) × pixelsPerDegree`. */
export function rulerOffset(theta: number, pxPerDegree = RULER_PX_PER_DEGREE): number {
	return turnAngle(theta) * pxPerDegree;
}

/**
 * Every whole-degree tick within `halfWidth` pixels of the needle. Every 5° is a mid tick and every
 * 15° a labelled major one, labelled with the angle it stands for in `(-180, 180]`.
 */
export function rulerTicks(
	theta: number,
	halfWidth: number,
	pxPerDegree = RULER_PX_PER_DEGREE,
): RulerTick[] {
	const ppd = pxPerDegree > 0 ? pxPerDegree : RULER_PX_PER_DEGREE;
	const centre = rulerOffset(theta, ppd) / ppd;
	const span = Math.max(0, halfWidth) / ppd;
	const first = Math.ceil(centre - span);
	const last = Math.floor(centre + span);
	const ticks: RulerTick[] = [];
	for (let d = first; d <= last; d++) {
		const wrapped = ((d % 360) + 360) % 360;
		const tier = wrapped % 15 === 0 ? "major" : wrapped % 5 === 0 ? "mid" : "minor";
		ticks.push({
			key: d,
			x: d * ppd - rulerOffset(theta, ppd),
			tier,
			label: tier === "major" ? `${wrapRotation(wrapped)}°` : null,
		});
	}
	return ticks;
}

/** The angle after the strip is dragged `dx` pixels — the strip follows the pointer. */
export function dragRotation(theta: number, dx: number, pxPerDegree = RULER_PX_PER_DEGREE): number {
	const ppd = pxPerDegree > 0 ? pxPerDegree : RULER_PX_PER_DEGREE;
	return wrapRotation(theta - dx / ppd);
}

/** The angle after a wheel notch; either axis rolls the strip, the larger one wins. */
export function wheelRotation(
	theta: number,
	deltaX: number,
	deltaY: number,
	deltaMode = 0,
): number {
	const raw = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
	const px = deltaMode === 1 ? raw * WHEEL_LINE_PX : deltaMode === 2 ? raw * WHEEL_PAGE_PX : raw;
	return wrapRotation(theta + px * WHEEL_DEG_PER_PX);
}

/** The angle a keyboard key moves to, or `null` for a key the ruler does not own. */
export function keyRotation(theta: number, key: string, large: boolean): number | null {
	const step = large ? RULER_STEP_LARGE : RULER_STEP;
	switch (key) {
		case "ArrowRight":
		case "ArrowUp":
			return wrapRotation(theta + step);
		case "ArrowLeft":
		case "ArrowDown":
			return wrapRotation(theta - step);
		case "PageUp":
			return wrapRotation(theta + RULER_STEP_LARGE);
		case "PageDown":
			return wrapRotation(theta - RULER_STEP_LARGE);
		case "Home":
			return 0;
		default:
			return null;
	}
}

// #endregion
