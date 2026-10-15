/**
 * facet-select — the lane facets' multi-select model, the file explorer's: a plain click selects only
 * that value (pressed again it returns the facet to its fallback), Ctrl/Cmd-click toggles one value,
 * Shift-click selects the run from the anchor to the target, and Ctrl/Cmd+Shift adds that run to what
 * is already selected. Pure, so it is tested without a DOM.
 */

// #region Types
/** How a facet row was pressed. */
export type FacetClick = "only" | "toggle" | "range" | "add-range";

/** The modifier keys a press carried. */
export interface FacetModifiers {
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/** A facet's selection and the value a Shift-click ranges from. */
export interface FacetPick<T> {
	selected: T[];
	anchor: T | null;
}
// #endregion

/** Read a press's modifiers as a {@link FacetClick}. */
export function facetClickOf(e: FacetModifiers): FacetClick {
	const toggle = e.ctrlKey || e.metaKey;
	if (e.shiftKey) return toggle ? "add-range" : "range";
	return toggle ? "toggle" : "only";
}

function inOrder<T>(order: readonly T[], values: Iterable<T>): T[] {
	const held = new Set(values);
	return order.filter((v) => held.has(v));
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((v) => b.includes(v));
}

/**
 * The facet's next selection. `order` is the rows as shown; `fallback` is what the facet holds with
 * nothing chosen (every value for an unfiltered facet is `[]`). A range with no usable anchor acts as
 * the plain or Ctrl/Cmd press it would otherwise be.
 */
export function pickFacet<T>(
	order: readonly T[],
	current: readonly T[],
	value: T,
	click: FacetClick,
	anchor: T | null,
	fallback: readonly T[],
): FacetPick<T> {
	const from = anchor !== null ? order.indexOf(anchor) : -1;
	const to = order.indexOf(value);
	if ((click === "range" || click === "add-range") && from >= 0 && to >= 0) {
		const run = order.slice(Math.min(from, to), Math.max(from, to) + 1);
		const base = click === "add-range" ? current : [];
		return { selected: inOrder(order, [...base, ...run]), anchor };
	}
	if (click === "toggle" || click === "add-range") {
		const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
		return { selected: inOrder(order, next), anchor: value };
	}
	if (sameSet(current, [value])) return { selected: inOrder(order, fallback), anchor: null };
	return { selected: [value], anchor: value };
}
