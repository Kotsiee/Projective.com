/**
 * Row selection for `DataTable` as a pure reducer over row ids. The anchor is an id, not an index,
 * so a range still starts from the same row after the list is re-sorted or re-filtered.
 */
import type { SelectionMode } from "../types/data-table.ts";

/** The selected ids plus the anchor a Shift gesture ranges from. */
export interface SelectionState {
	selected: ReadonlySet<string>;
	anchor: string | null;
}

/**
 * What the viewer did:
 * - `row`: a click on the row body (Ctrl/Cmd toggles, Shift selects the range, both add the range);
 * - `check`: a click on the row's check (Shift applies the row's new state to the whole range);
 * - `toggle`: Space on the focused row;
 * - `extend`: Shift+Arrow onto a row (selects the range from the anchor, or from `from`, the row
 *   focus left, when there is no anchor yet);
 * - `all` / `none`: select every listed row, or clear.
 */
export type SelectionGesture =
	| { kind: "row"; id: string; ctrl: boolean; shift: boolean }
	| { kind: "check"; id: string; shift: boolean }
	| { kind: "toggle"; id: string }
	| { kind: "extend"; id: string; from?: string }
	| { kind: "all" }
	| { kind: "none" };

/** An empty selection. */
export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

/** The ids from `a` to `b` inclusive in `order`, or `null` when either is not listed. */
export function rangeBetween(order: readonly string[], a: string, b: string): string[] | null {
	const i = order.indexOf(a);
	const j = order.indexOf(b);
	if (i < 0 || j < 0) return null;
	return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

function toggled(selected: ReadonlySet<string>, id: string): Set<string> {
	const next = new Set(selected);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

function single(state: SelectionState, id: string, allowClear: boolean): SelectionState {
	const clear = allowClear && state.selected.has(id) && state.selected.size === 1;
	return { selected: clear ? new Set() : new Set([id]), anchor: id };
}

/** Apply a gesture under a selection mode. `order` is the rows as currently listed. */
export function applySelection(
	state: SelectionState,
	gesture: SelectionGesture,
	mode: SelectionMode,
	order: readonly string[],
): SelectionState {
	if (mode === "none") return state;
	if (gesture.kind === "none") return { selected: new Set(), anchor: null };

	if (mode === "single") {
		switch (gesture.kind) {
			case "all":
				return state;
			case "row":
				return single(state, gesture.id, gesture.ctrl);
			case "check":
			case "toggle":
				return single(state, gesture.id, true);
			case "extend":
				return single(state, gesture.id, false);
		}
	}

	switch (gesture.kind) {
		case "all":
			return { selected: new Set(order), anchor: state.anchor };
		case "toggle":
			return { selected: toggled(state.selected, gesture.id), anchor: gesture.id };
		case "extend": {
			const listed = state.anchor !== null && order.includes(state.anchor);
			const anchor = listed ? state.anchor : gesture.from ?? null;
			const range = anchor ? rangeBetween(order, anchor, gesture.id) : null;
			return range
				? { selected: new Set(range), anchor }
				: { selected: new Set([gesture.id]), anchor: gesture.id };
		}
		case "check": {
			const range = gesture.shift && state.anchor
				? rangeBetween(order, state.anchor, gesture.id)
				: null;
			if (!range) return { selected: toggled(state.selected, gesture.id), anchor: gesture.id };
			const select = !state.selected.has(gesture.id);
			const next = new Set(state.selected);
			for (const id of range) {
				if (select) next.add(id);
				else next.delete(id);
			}
			return { selected: next, anchor: state.anchor };
		}
		case "row": {
			const range = gesture.shift && state.anchor
				? rangeBetween(order, state.anchor, gesture.id)
				: null;
			if (range) {
				const next = gesture.ctrl ? new Set(state.selected) : new Set<string>();
				for (const id of range) next.add(id);
				return { selected: next, anchor: state.anchor };
			}
			if (gesture.ctrl) {
				return { selected: toggled(state.selected, gesture.id), anchor: gesture.id };
			}
			return { selected: new Set([gesture.id]), anchor: gesture.id };
		}
	}
}

/** The header check's state over the listed rows. */
export function headerCheckState(
	selected: ReadonlySet<string>,
	order: readonly string[],
): "none" | "some" | "all" {
	if (order.length === 0 || selected.size === 0) return "none";
	let hits = 0;
	for (const id of order) if (selected.has(id)) hits++;
	if (hits === 0) return "none";
	return hits === order.length ? "all" : "some";
}

/** Drop selected ids that are no longer listed (after a reload or a filter). */
export function pruneSelection(
	selected: ReadonlySet<string>,
	order: readonly string[],
): ReadonlySet<string> {
	const listed = new Set(order);
	let changed = false;
	const next = new Set<string>();
	for (const id of selected) {
		if (listed.has(id)) next.add(id);
		else changed = true;
	}
	return changed ? next : selected;
}
