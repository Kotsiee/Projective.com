/**
 * Range arithmetic shared by `Slider`, `RangeSlider` and `MilestoneSlider`.
 *
 * Pure and DOM-free so the one rule that decides where a handle lands — and which handle a value now
 * belongs to once two of them have crossed — is written once and unit-tested, rather than re-derived
 * inside each pointer handler.
 */

// #region Clamp + snap
/** Clamp `n` into the inclusive `[lo, hi]` range. */
export function clampRange(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Snap `v` onto the `step` grid anchored at `min`, then clamp into `[min, max]`. Float noise from
 * the divide/multiply is trimmed so `0.1 + 0.2`-class residue never reaches the value.
 */
export function snapValue(v: number, min: number, max: number, step: number): number {
	const unit = step > 0 ? step : 1;
	const stepped = Math.round((v - min) / unit) * unit + min;
	const fixed = Math.round(stepped * 1e6) / 1e6;
	return clampRange(fixed, min, max);
}
// #endregion

// #region Dual-handle resolution
/** The outcome of moving one of two handles. */
export interface PairMove {
	/** The pair, always ordered `[lower, upper]`. */
	pair: [number, number];
	/**
	 * Whether the FIRST DOM handle now holds the UPPER value. Handles keep a stable identity across a
	 * crossing (so pointer capture and focus stay on the element the reader is holding), and this flag
	 * is how the sorted pair maps back onto them.
	 */
	swapped: boolean;
}

/**
 * Resolve a move of handle `index` (0 or 1, by DOM identity) to `next`, given the OTHER handle's
 * value and whether the two may pass each other.
 *
 * With `allowCross` the values simply re-sort and the moving handle takes whichever end it landed on;
 * without it the moving handle is stopped at its neighbour, which is the classic non-crossing range.
 * A move that lands exactly on the neighbour keeps the previous orientation, so a handle dragged onto
 * its twin and back does not flip roles for no reason.
 */
export function resolvePairMove(
	index: 0 | 1,
	next: number,
	other: number,
	swapped: boolean,
	allowCross: boolean,
): PairMove {
	if (!allowCross) {
		const first = swapped ? 1 : 0;
		const isLower = index === first;
		const v = isLower ? Math.min(next, other) : Math.max(next, other);
		return { pair: isLower ? [v, other] : [other, v], swapped };
	}
	if (next === other) return { pair: [next, next], swapped };
	const pair: [number, number] = next < other ? [next, other] : [other, next];
	return { pair, swapped: index === 0 ? next > other : next < other };
}

/** Which of two values `target` is nearest to — ties go to the lower handle. */
export function nearestOfPair(values: readonly [number, number], target: number): 0 | 1 {
	return Math.abs(values[0] - target) <= Math.abs(values[1] - target) ? 0 : 1;
}
// #endregion

// #region Milestones
/** One labelled stop on a discrete, non-linear track. */
export interface Milestone {
	/** The value this stop stands for — in the caller's own unit (days, seats, £). */
	value: number;
	/** What the stop is called; also the spoken `aria-valuetext`. */
	label: string;
}

/**
 * Index of the milestone nearest to `value`. A value between two stops resolves to the closer one, a
 * tie to the earlier, and anything outside the track to its nearest end — so a stored value the track
 * no longer offers still lands on a stop rather than on nothing.
 */
export function nearestMilestone(milestones: readonly Milestone[], value: number): number {
	if (milestones.length === 0) return 0;
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	milestones.forEach((m, i) => {
		const d = Math.abs(m.value - value);
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	});
	return best;
}
// #endregion
