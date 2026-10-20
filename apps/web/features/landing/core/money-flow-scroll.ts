/**
 * money-flow-scroll — where "How it works"'s reading line sits, and which step a scroll position has
 * reached (`flows/LANDING.md` §4.3; Decision #288 (F): a scroll-linked stage that never hijacks
 * native scroll). The page scrolls as it always does; the stage only reads where the steps are.
 *
 * A step becomes the stage's step once its top edge reaches the reading line, {@link FLOW_LINE} of
 * the viewport's height from its top. The MoneyFlow island watches the line with an
 * IntersectionObserver ({@link flowRootMargin}) and asks {@link activeStepAt} which step it has
 * reached; `lp-money-flow.css` draws its scroll-linked fills on view timelines inset to the same
 * line (`--mf-line`), so a fill completes exactly as its step takes the stage.
 *
 * Dependency-free on purpose: the island imports this module, and whatever it imported would ship
 * in the island's chunk.
 */

// #region Reading line
/**
 * The reading line, as a fraction of the viewport's height from its top. `lp-money-flow.css` pins
 * the same line as `--mf-line` (checked by `money-flow.test.ts`).
 */
export const FLOW_LINE = 0.4;

/**
 * The IntersectionObserver root margin that reports a step crossing the reading line: a band one
 * percent of the viewport tall whose top edge is the line, so no step is ever missed by a band of
 * zero height.
 */
export function flowRootMargin(line: number = FLOW_LINE): string {
	const top = Math.round(line * 100);
	return `-${top}% 0px -${Math.max(0, 99 - top)}% 0px`;
}
// #endregion

// #region Active step
/**
 * The index of the step the reading line has reached: the last step whose top edge is at or above
 * the line (`tops` and `line` in the same viewport coordinates). Before the first step reaches it,
 * the stage keeps the first step, so the flow always starts from the beginning.
 */
export function activeStepAt(tops: readonly number[], line: number): number {
	let active = 0;
	tops.forEach((top, index) => {
		if (top <= line && index > active) active = index;
	});
	return active;
}
// #endregion
