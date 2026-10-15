import { assertEquals } from "@std/assert";
import {
	applySelection,
	EMPTY_SELECTION,
	headerCheckState,
	pruneSelection,
	type SelectionState,
} from "./table-selection.ts";

const order = ["a", "b", "c", "d", "e"];
const state = (ids: string[], anchor: string | null): SelectionState => ({
	selected: new Set(ids),
	anchor,
});
const ids = (s: SelectionState) => [...s.selected].sort();

// #region Multiple
Deno.test("a plain row click selects only that row and anchors it", () => {
	const next = applySelection(
		state(["a", "b"], "a"),
		{
			kind: "row",
			id: "c",
			ctrl: false,
			shift: false,
		},
		"multiple",
		order,
	);
	assertEquals(ids(next), ["c"]);
	assertEquals(next.anchor, "c");
});

Deno.test("Ctrl/Cmd+click toggles one row and moves the anchor", () => {
	const on = applySelection(
		state(["a"], "a"),
		{ kind: "row", id: "c", ctrl: true, shift: false },
		"multiple",
		order,
	);
	assertEquals(ids(on), ["a", "c"]);
	assertEquals(on.anchor, "c");
	const off = applySelection(
		on,
		{ kind: "row", id: "a", ctrl: true, shift: false },
		"multiple",
		order,
	);
	assertEquals(ids(off), ["c"]);
});

Deno.test("Shift+click replaces the selection with the range and keeps the anchor", () => {
	const next = applySelection(
		state(["e"], "b"),
		{ kind: "row", id: "d", ctrl: false, shift: true },
		"multiple",
		order,
	);
	assertEquals(ids(next), ["b", "c", "d"]);
	assertEquals(next.anchor, "b");
	const back = applySelection(
		next,
		{ kind: "row", id: "a", ctrl: false, shift: true },
		"multiple",
		order,
	);
	assertEquals(ids(back), ["a", "b"]);
});

Deno.test("Ctrl+Shift+click adds the range to the selection", () => {
	const next = applySelection(
		state(["e"], "b"),
		{ kind: "row", id: "c", ctrl: true, shift: true },
		"multiple",
		order,
	);
	assertEquals(ids(next), ["b", "c", "e"]);
});

Deno.test("the anchor is an id, so a range survives a re-sort", () => {
	const resorted = ["e", "d", "c", "b", "a"];
	const next = applySelection(
		state(["b"], "b"),
		{ kind: "row", id: "d", ctrl: false, shift: true },
		"multiple",
		resorted,
	);
	assertEquals(ids(next), ["b", "c", "d"]);
});

Deno.test("Shift with an anchor that is no longer listed acts as a plain click", () => {
	const next = applySelection(
		state(["z"], "z"),
		{ kind: "row", id: "c", ctrl: false, shift: true },
		"multiple",
		order,
	);
	assertEquals(ids(next), ["c"]);
	assertEquals(next.anchor, "c");
});

Deno.test("a check click toggles without clearing the others", () => {
	const next = applySelection(
		state(["a"], "a"),
		{ kind: "check", id: "c", shift: false },
		"multiple",
		order,
	);
	assertEquals(ids(next), ["a", "c"]);
});

Deno.test("Shift on a check applies the clicked row's new state to the range", () => {
	const selecting = applySelection(
		state(["a"], "a"),
		{ kind: "check", id: "c", shift: true },
		"multiple",
		order,
	);
	assertEquals(ids(selecting), ["a", "b", "c"]);
	const clearing = applySelection(
		state(["a", "b", "c", "e"], "a"),
		{ kind: "check", id: "c", shift: true },
		"multiple",
		order,
	);
	assertEquals(ids(clearing), ["e"]);
});

Deno.test("Shift+Arrow with no anchor ranges from the row focus left", () => {
	const next = applySelection(
		state([], null),
		{ kind: "extend", id: "c", from: "b" },
		"multiple",
		order,
	);
	assertEquals(ids(next), ["b", "c"]);
	assertEquals(next.anchor, "b");
});

Deno.test("Shift+Arrow extends from the anchor", () => {
	const next = applySelection(state(["b"], "b"), { kind: "extend", id: "d" }, "multiple", order);
	assertEquals(ids(next), ["b", "c", "d"]);
	assertEquals(next.anchor, "b");
});

Deno.test("select all takes every listed row; none clears the anchor too", () => {
	const all = applySelection(state([], "b"), { kind: "all" }, "multiple", order);
	assertEquals(ids(all), order);
	const none = applySelection(all, { kind: "none" }, "multiple", order);
	assertEquals(none, { selected: new Set<string>(), anchor: null });
});
// #endregion

// #region Single + none
Deno.test("single mode keeps at most one row", () => {
	const a = applySelection(
		EMPTY_SELECTION,
		{ kind: "row", id: "a", ctrl: false, shift: false },
		"single",
		order,
	);
	const range = applySelection(
		a,
		{ kind: "row", id: "d", ctrl: false, shift: true },
		"single",
		order,
	);
	assertEquals(ids(range), ["d"]);
	const cleared = applySelection(range, { kind: "check", id: "d", shift: false }, "single", order);
	assertEquals(ids(cleared), []);
	assertEquals(applySelection(range, { kind: "all" }, "single", order), range);
});

Deno.test("mode none ignores every gesture", () => {
	const s = state(["a"], "a");
	assertEquals(
		applySelection(s, { kind: "row", id: "b", ctrl: false, shift: false }, "none", order),
		s,
	);
});
// #endregion

// #region Helpers
Deno.test("the header check reads none, some or all of the listed rows", () => {
	assertEquals(headerCheckState(new Set(), order), "none");
	assertEquals(headerCheckState(new Set(["a", "z"]), order), "some");
	assertEquals(headerCheckState(new Set(order), order), "all");
	assertEquals(headerCheckState(new Set(["z"]), order), "none");
	assertEquals(headerCheckState(new Set(["a"]), []), "none");
});

Deno.test("pruning drops unlisted ids and keeps identity when nothing changes", () => {
	const kept = new Set(["a", "b"]);
	assertEquals(pruneSelection(kept, order) === kept, true);
	assertEquals([...pruneSelection(new Set(["a", "z"]), order)], ["a"]);
});
// #endregion
