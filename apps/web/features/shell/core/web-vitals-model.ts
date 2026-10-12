import type { WebVitalName, WebVitalRating } from "@projective/types/logging";

/** The published Core Web Vitals bands: `[good ≤, poor >]`. CLS is unitless; LCP/INP are ms. */
export const VITAL_THRESHOLDS: Record<WebVitalName, readonly [number, number]> = {
	CLS: [0.1, 0.25],
	LCP: [2500, 4000],
	INP: [200, 500],
};

/** Which band a value falls in. */
export function rateVital(name: WebVitalName, value: number): WebVitalRating {
	const [good, poor] = VITAL_THRESHOLDS[name];
	if (value <= good) return "good";
	return value > poor ? "poor" : "needs-improvement";
}

/** Shifts more than this apart start a new session window. */
const WINDOW_GAP_MS = 1000;
/** A session window never spans longer than this. */
const WINDOW_MAX_MS = 5000;

/**
 * Cumulative Layout Shift as the largest SESSION WINDOW: shifts closer than 1 s apart, inside a
 * 5 s span, add up; the page's CLS is the worst such burst, not the lifetime sum.
 */
export class LayoutShiftWindows {
	#current = 0;
	#first = 0;
	#last = 0;
	#worst = 0;

	/** Add one shift (`LayoutShift.value` at `startTime`) not caused by recent input. */
	add(value: number, startTime: number): void {
		const continues = this.#current > 0 &&
			startTime - this.#last < WINDOW_GAP_MS &&
			startTime - this.#first < WINDOW_MAX_MS;
		if (continues) {
			this.#current += value;
		} else {
			this.#current = value;
			this.#first = startTime;
		}
		this.#last = startTime;
		this.#worst = Math.max(this.#worst, this.#current);
	}

	/** The page's CLS so far. */
	get value(): number {
		return this.#worst;
	}
}

/**
 * Interaction to Next Paint from each interaction's longest event duration: the worst interaction,
 * skipping one outlier per 50 interactions (a ~98th percentile). `null` with no interactions.
 */
export function inpFrom(durations: number[]): number | null {
	if (durations.length === 0) return null;
	const sorted = [...durations].sort((a, b) => b - a);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))];
}
