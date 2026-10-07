/**
 * The DatePicker's period navigation — which shortcut moves the view how far, how a wheel stream
 * becomes whole steps, and how a format takes a caller's delimiter. Pure and framework-free, so the
 * rules are unit-tested here rather than reachable only by dispatching events.
 */

import { clampDayToMonth } from "./datetime.ts";

// #region Types

/** Separators a caller may force between the day, month and year segments. */
export type DateDelimiter = "/" | "." | "-";

/** The key and modifier state a period shortcut is read from — a structural subset of `KeyboardEvent`. */
export interface PeriodKeyInput {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/** One wheel event, reduced to what {@link createWheelStepper} reads. */
export interface WheelSample {
	deltaX: number;
	deltaY: number;
	/** `WheelEvent.deltaMode`: `0` pixels, `1` lines, `2` pages. */
	deltaMode: number;
	/** Event time in ms; only differences between samples are read. */
	timeStamp: number;
	/** Chromium/WebKit's legacy `wheelDeltaY`, when present — the mouse-versus-trackpad tell. */
	wheelDeltaY?: number;
}

/** Turns a stream of wheel samples into whole navigation steps. */
export interface WheelStepper {
	/** `1` (wheel up), `-1` (wheel down), or `0` when this sample does not complete a step. */
	feed(sample: WheelSample): -1 | 0 | 1;
}

// #endregion

// #region Constants

/** Months a Ctrl/Cmd + Shift + Up/Down jump covers. */
export const YEAR_LEAP_MONTHS = 5 * 12;

/** Pixel travel that completes one step. */
export const WHEEL_STEP_PX = 50;

/**
 * Silence, ms, that ends a wheel burst and re-arms the stepper. Above a trackpad's per-frame cadence
 * (8–16ms), below the spacing of separate mouse notches.
 */
export const WHEEL_GAP_MS = 50;

/** Chromium/WebKit report one mouse notch as a legacy `wheelDelta` of this, or a multiple of it. */
const LEGACY_NOTCH = 120;

// #endregion

// #region Keyboard

/**
 * The months a period shortcut moves the view by, or `null` when the event is not one.
 *
 * | Shortcut (Cmd on macOS)   | Months |
 * | :------------------------ | -----: |
 * | Ctrl + Up / Down          |   ±12  |
 * | Ctrl + Shift + Up / Down  |   ±60  |
 * | Ctrl + Right / Left       |    ±1  |
 */
export function periodStepForKey(e: PeriodKeyInput): number | null {
	if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
	switch (e.key) {
		case "ArrowUp":
			return e.shiftKey ? YEAR_LEAP_MONTHS : 12;
		case "ArrowDown":
			return e.shiftKey ? -YEAR_LEAP_MONTHS : -12;
		case "ArrowRight":
			return e.shiftKey ? null : 1;
		case "ArrowLeft":
			return e.shiftKey ? null : -1;
		default:
			return null;
	}
}

/** Move `d` by whole months, keeping its day and clamping it to the target month's length. */
export function shiftMonthsKeepingDay(d: Date, months: number): Date {
	const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
	const year = target.getFullYear();
	const month = target.getMonth();
	return new Date(year, month, clampDayToMonth(year, month, d.getDate()));
}

// #endregion

// #region Wheel

/**
 * Does this one sample stand for a whole mouse notch, however few pixels it reports?
 *
 * Line and page modes are always notches. In pixel mode the legacy `wheelDeltaY` is the only
 * device-independent tell: a multiple of 120 is a notch, while a trackpad or a free-spinning wheel
 * reports arbitrary values.
 */
export function isWheelNotch(sample: WheelSample): boolean {
	if (sample.deltaMode !== 0) return true;
	const legacy = sample.wheelDeltaY;
	return legacy !== undefined && legacy !== 0 && legacy % LEGACY_NOTCH === 0;
}

/**
 * Create a stepper that maps a wheel stream onto whole steps.
 *
 * Travel accumulates to {@link WHEEL_STEP_PX} (a notch completes a step on its own), steps once,
 * then stays latched until the stream falls silent for {@link WHEEL_GAP_MS} or reverses. A trackpad
 * flick and its momentum arrive every frame and so are one step; separate notches arrive further
 * apart and each one steps. Mostly-horizontal samples are ignored.
 */
export function createWheelStepper(): WheelStepper {
	let accumulated = 0;
	let latched = false;
	let lastSample = Number.NEGATIVE_INFINITY;
	let lastDirection: -1 | 1 = 1;

	return {
		feed(sample) {
			const { deltaX, deltaY, timeStamp } = sample;
			if (deltaY === 0 || Math.abs(deltaX) > Math.abs(deltaY)) return 0;
			const direction: -1 | 1 = deltaY < 0 ? 1 : -1;

			const paused = timeStamp - lastSample > WHEEL_GAP_MS;
			const reversed = direction !== lastDirection;
			lastSample = timeStamp;
			lastDirection = direction;
			if (paused || reversed) {
				accumulated = 0;
				latched = false;
			}
			if (latched) return 0;

			accumulated = isWheelNotch(sample) ? WHEEL_STEP_PX : accumulated + Math.abs(deltaY);
			if (accumulated < WHEEL_STEP_PX) return 0;
			accumulated = 0;
			latched = true;
			return direction;
		},
	};
}

// #endregion

// #region Format

/**
 * `format` with every separator run between its tokens replaced by `delimiter`, or `format`
 * unchanged when no delimiter is given. `dd/mm/yyyy` with `.` becomes `dd.mm.yyyy`.
 */
export function applyDelimiter(format: string, delimiter?: DateDelimiter): string {
	if (!delimiter) return format;
	return format.replace(/[\/.,\-\s]+/g, delimiter);
}

// #endregion
