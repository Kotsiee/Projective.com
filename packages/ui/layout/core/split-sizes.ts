/**
 * The Splitter's sizing rule, extracted so it can be exercised without a DOM.
 *
 * A split layout has three possible answers to "how wide is each pane", and the order they are tried
 * in is the whole rule: the ratio currently in force (a drag, or a keyboard resize) beats the ratio
 * persisted from a previous visit, which beats the seeds the caller declared. Each is used only when
 * it describes THIS many panes — a ratio of the wrong length describes a layout that no longer
 * exists, and using it anyway is what left a modal's surviving pane at the 68% it held as the leading
 * half of a split, with a third of the container empty beside it and (in the mirror case, a pane
 * appearing rather than disappearing) a `--split-size: undefined%` and an `aria-valuenow="NaN"`.
 */

/**
 * Resolve the sizes that apply to `seeds.length` panes.
 *
 * @param tracked The ratio currently in force — the component's own live state. Wins outright when
 *   its length matches, which is what makes a dragged ratio survive re-renders: the caller's `size`
 *   props are a SEED, not a binding, and are not consulted again while it holds.
 * @param seeds Each pane's declared `size`, `undefined` where it did not declare one. Panes without
 *   one share whatever the declared ones leave, so a partial declaration still sums to 100.
 * @param persisted Reads the ratio stored for this layout, or `null`. Lazy, because it is a
 *   `localStorage` hit and the common path never needs it.
 */
export function resolveSplitSizes(
	tracked: readonly number[],
	seeds: readonly (number | undefined)[],
	persisted: () => readonly number[] | null,
): number[] {
	const count = seeds.length;
	if (tracked.length === count) return [...tracked];

	const stored = persisted();
	// Length-checked rather than padded or truncated: a stored ratio for a different pane count is not
	// a worse answer to this question, it is an answer to a different one.
	if (stored && stored.length === count) return [...stored];

	const declaredSum = seeds.reduce<number>((sum, v) => sum + (v ?? 0), 0);
	const undeclared = seeds.filter((v) => v === undefined).length;
	const remaining = Math.max(0, 100 - declaredSum);
	return seeds.map((v) => v ?? (undeclared ? remaining / undeclared : 0));
}
