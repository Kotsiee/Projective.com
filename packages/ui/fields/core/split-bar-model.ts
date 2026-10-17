/**
 * The proportional split arithmetic behind `SplitBar`.
 *
 * Pure, DOM-free and integer-only: a split is a row of segments measured in **basis points** that
 * always totals {@link SPLIT_TOTAL_BP}. Handle `i` sits between segment `i` and segment `i + 1`, and
 * moving it trades basis points between exactly those two neighbours — nothing further down the row
 * changes, so the pair's combined share is conserved and the 100% invariant holds by construction
 * rather than by a rebalance pass. Every function that produces a split asserts the invariant on its
 * output, so a regression throws in a unit test instead of rendering a split that silently sums to
 * 99.99%.
 *
 * Held segments are frozen: a handle with a held neighbour does not move. Each segment's `min`
 * (default 0) is a floor the opposite neighbour can never push it below.
 */

// #region Types
/** One segment of a proportional split. */
export interface SplitSegment {
	/** Stable identity — keys the rendered segment and handle across re-orders. */
	key: string;
	/** Human label, named in the handle's accessible name/value text and the legend. */
	label: string;
	/** Share in integer basis points (1 bp = 0.01%). */
	bp: number;
	/** A held segment is never changed by a neighbour's drag; its handles lock. */
	held?: boolean;
	/** Floor in basis points this segment can be squeezed to (default 0). */
	min?: number;
}

/** What produced a change — a pointer drag or a key press. */
export type SplitChangeSource = "drag" | "key";

/** The reachable range of one handle, expressed as the LEFT segment's share. */
export interface SplitHandleRange {
	/** Lowest share the left segment can reach (its own floor). */
	min: number;
	/** Highest share the left segment can reach (the pair total less the right segment's floor). */
	max: number;
	/** The left segment's current share. */
	now: number;
	/** Whether the handle cannot move at all (a held neighbour, or no room inside the floors). */
	locked: boolean;
}
// #endregion

// #region Constants
/** The whole: 100.00% in basis points. */
export const SPLIT_TOTAL_BP = 10_000;

/** Step sizes in basis points — 1 bp per pointer pixel-step, 1% per arrow, 0.1% fine, 10% per page. */
export const SPLIT_STEP_POINTER_BP = 1;
export const SPLIT_STEP_KEY_BP = 100;
export const SPLIT_STEP_FINE_BP = 10;
export const SPLIT_STEP_PAGE_BP = 1_000;
// #endregion

// #region Invariant
/** Sum of every segment's share. */
export function splitTotal(segments: readonly SplitSegment[]): number {
	let sum = 0;
	for (const s of segments) sum += s.bp;
	return sum;
}

/** Whether the split is a well-formed whole: integer, non-negative shares summing to 10 000. */
export function isBalancedSplit(segments: readonly SplitSegment[]): boolean {
	for (const s of segments) {
		if (!Number.isInteger(s.bp) || s.bp < 0) return false;
	}
	return segments.length > 0 && splitTotal(segments) === SPLIT_TOTAL_BP;
}

/**
 * Throw unless the split is balanced. Called on every split the model produces; reaching it with a
 * bad split is a bug in this module, never a user state, so it fails loudly.
 */
export function assertBalancedSplit(segments: readonly SplitSegment[]): void {
	if (!isBalancedSplit(segments)) {
		throw new Error(
			`split-bar-model: split must be integer bp summing to ${SPLIT_TOTAL_BP}, got ${
				splitTotal(segments)
			}`,
		);
	}
}
// #endregion

// #region Handle geometry
/** The floor of a segment, clamped to a non-negative integer. */
function floorOf(segment: SplitSegment): number {
	return Math.max(0, Math.trunc(segment.min ?? 0));
}

/** Cumulative share, in basis points, of every segment up to AND including `index`. */
export function boundaryAt(segments: readonly SplitSegment[], index: number): number {
	let sum = 0;
	for (let i = 0; i <= index && i < segments.length; i++) sum += segments[i].bp;
	return sum;
}

/**
 * The reachable range of handle `index` (between segment `index` and `index + 1`). An out-of-range
 * index, a held neighbour, an unbalanced split or floors that leave no room all report `locked`.
 */
export function handleRange(segments: readonly SplitSegment[], index: number): SplitHandleRange {
	const left = segments[index];
	const right = segments[index + 1];
	if (!left || !right) return { min: 0, max: 0, now: 0, locked: true };
	const pair = left.bp + right.bp;
	const min = Math.min(floorOf(left), pair);
	const max = Math.max(min, pair - floorOf(right));
	const locked = Boolean(left.held || right.held) || max <= min || !isBalancedSplit(segments);
	return { min, max, now: left.bp, locked };
}
// #endregion

// #region Moves
/**
 * Set handle `index` so the LEFT segment holds `leftBp`, the right neighbour absorbing the
 * difference. The request is rounded to an integer and clamped into {@link handleRange}; a locked
 * handle returns the input unchanged (same reference), so a caller can skip a no-op emit.
 */
export function setHandle(
	segments: readonly SplitSegment[],
	index: number,
	leftBp: number,
): readonly SplitSegment[] {
	const range = handleRange(segments, index);
	if (range.locked || !Number.isFinite(leftBp)) return segments;
	const next = Math.min(range.max, Math.max(range.min, Math.round(leftBp)));
	if (next === range.now) return segments;
	const pair = segments[index].bp + segments[index + 1].bp;
	const out = segments.map((s, i) =>
		i === index ? { ...s, bp: next } : i === index + 1 ? { ...s, bp: pair - next } : s
	);
	assertBalancedSplit(out);
	return out;
}

/** Move handle `index` by `deltaBp` (positive grows the left segment). */
export function nudgeHandle(
	segments: readonly SplitSegment[],
	index: number,
	deltaBp: number,
): readonly SplitSegment[] {
	const left = segments[index];
	if (!left) return segments;
	return setHandle(segments, index, left.bp + deltaBp);
}

/**
 * Place handle `index` at an absolute boundary position on the track — the cumulative share up to
 * and including segment `index`, as a pointer reports it. Absolute rather than relative so repeated
 * pointer moves are idempotent and never accumulate rounding drift.
 */
export function dragHandleTo(
	segments: readonly SplitSegment[],
	index: number,
	boundaryBp: number,
): readonly SplitSegment[] {
	const left = segments[index];
	if (!left) return segments;
	const before = boundaryAt(segments, index) - left.bp;
	const snapped = Math.round(boundaryBp / SPLIT_STEP_POINTER_BP) * SPLIT_STEP_POINTER_BP;
	return setHandle(segments, index, snapped - before);
}
// #endregion

// #region Keyboard
/** The keys a split handle answers, after reading-direction resolution. */
export interface SplitKeyInput {
	key: string;
	shiftKey?: boolean;
	/** Right-to-left: horizontal arrows invert so "towards the reader's end" stays "more". */
	rtl?: boolean;
}

/**
 * Resolve a key press on handle `index` to the next split, or `null` when the key is not one the
 * handle owns (so the caller leaves the event alone). Arrows step 1% (Shift: 0.1%), PageUp/PageDown
 * step 10%, Home/End jump to the handle's floor/ceiling. A recognised key on a locked handle returns
 * the input unchanged — the key is still consumed, so it does not scroll the page.
 */
export function keyToSplit(
	segments: readonly SplitSegment[],
	index: number,
	input: SplitKeyInput,
): readonly SplitSegment[] | null {
	const step = input.shiftKey ? SPLIT_STEP_FINE_BP : SPLIT_STEP_KEY_BP;
	const range = handleRange(segments, index);
	switch (input.key) {
		case "ArrowRight":
			return nudgeHandle(segments, index, input.rtl ? -step : step);
		case "ArrowLeft":
			return nudgeHandle(segments, index, input.rtl ? step : -step);
		case "ArrowUp":
			return nudgeHandle(segments, index, step);
		case "ArrowDown":
			return nudgeHandle(segments, index, -step);
		case "PageUp":
			return nudgeHandle(segments, index, SPLIT_STEP_PAGE_BP);
		case "PageDown":
			return nudgeHandle(segments, index, -SPLIT_STEP_PAGE_BP);
		case "Home":
			return setHandle(segments, index, range.min);
		case "End":
			return setHandle(segments, index, range.max);
		default:
			return null;
	}
}
// #endregion

// #region Formatting
/** Basis points as a percent number with two decimals (`4250` → `42.5`), for `aria-valuenow`. */
export function bpToPercent(bp: number): number {
	return Math.round(bp) / 100;
}

/** Basis points as display text with exactly two decimals (`4250` → `"42.50%"`). */
export function formatSplitPercent(bp: number): string {
	return `${bpToPercent(bp).toFixed(2)}%`;
}

/** The handle's spoken value: `"<left> 42.50% · <right> 17.50%"`. */
export function handleValueText(segments: readonly SplitSegment[], index: number): string {
	const left = segments[index];
	const right = segments[index + 1];
	if (!left || !right) return "";
	return `${left.label} ${formatSplitPercent(left.bp)} · ${right.label} ${
		formatSplitPercent(right.bp)
	}`;
}

/** The handle's accessible name, naming both neighbours. */
export function handleLabel(segments: readonly SplitSegment[], index: number): string {
	const left = segments[index];
	const right = segments[index + 1];
	if (!left || !right) return "";
	return `Split between ${left.label} and ${right.label}`;
}
// #endregion
