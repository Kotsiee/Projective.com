/**
 * confirm-keys — how the arrow keys walk a confirmation's action pair, kept pure so the rule is
 * testable without a DOM.
 *
 * @module
 */

/**
 * The action an arrow key moves focus to from `index` among `count` actions in reading order, or
 * `null` when the key does not move it. ← and → step and wrap, mirrored under right-to-left; Home and
 * End jump to the ends.
 */
export function confirmActionTarget(
	key: string,
	index: number,
	count: number,
	rtl = false,
): number | null {
	if (count < 2 || index < 0 || index >= count) return null;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	const forward = rtl ? "ArrowLeft" : "ArrowRight";
	const back = rtl ? "ArrowRight" : "ArrowLeft";
	if (key === forward) return (index + 1) % count;
	if (key === back) return (index - 1 + count) % count;
	return null;
}
