/**
 * @projective/ui/fields — NumberStepper's pure key model (plan §4.5): ↑/↓ step by `step`,
 * PageUp/PageDown by `bigStep`, Home/End jump to the bounds. Every result is snapped to the step grid
 * anchored at `min` and clamped, so the value a key lands on is always one the field can hold.
 */
import { clampNumber, snapToStep } from "./number-field.ts";

/** The stepper's bounds and increments. */
export interface StepperBounds {
	min?: number;
	max?: number;
	/** Default 1. */
	step?: number;
	/** Default `step × 10`. */
	bigStep?: number;
}

/** Snap and clamp a candidate value into the stepper's domain. */
export function settleStepper(value: number, bounds: StepperBounds): number {
	const step = bounds.step ?? 1;
	return clampNumber(snapToStep(value, step, bounds.min ?? 0), bounds.min, bounds.max);
}

/**
 * The value a key moves to, or `undefined` when the key is not the stepper's. A `null` value starts
 * from `min` (or 0). Home/End without that bound are not handled.
 */
export function stepperKey(
	value: number | null,
	key: string,
	bounds: StepperBounds,
): number | undefined {
	const step = bounds.step ?? 1;
	const big = bounds.bigStep ?? step * 10;
	const from = value ?? bounds.min ?? 0;
	switch (key) {
		case "ArrowUp":
			return settleStepper(from + step, bounds);
		case "ArrowDown":
			return settleStepper(from - step, bounds);
		case "PageUp":
			return settleStepper(from + big, bounds);
		case "PageDown":
			return settleStepper(from - big, bounds);
		case "Home":
			return bounds.min === undefined ? undefined : bounds.min;
		case "End":
			return bounds.max === undefined ? undefined : bounds.max;
		default:
			return undefined;
	}
}
