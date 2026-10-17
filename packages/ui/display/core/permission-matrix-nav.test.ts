import { assertEquals } from "@std/assert";
import {
	cellAccessibleName,
	cellPressed,
	cellToggleable,
	clampPos,
	groupRuns,
	type MatrixDims,
	matrixKeyIntent,
	moveFocus,
} from "./permission-matrix-nav.ts";

const dims: MatrixDims = { rows: 3, cols: 4 };
const k = (key: string, ctrlKey = false, metaKey = false) => ({ key, ctrlKey, metaKey });

Deno.test("arrows move one cell", () => {
	const at = { row: 1, col: 1 };
	assertEquals(moveFocus(at, k("ArrowRight"), dims), { row: 1, col: 2 });
	assertEquals(moveFocus(at, k("ArrowLeft"), dims), { row: 1, col: 0 });
	assertEquals(moveFocus(at, k("ArrowDown"), dims), { row: 2, col: 1 });
	assertEquals(moveFocus(at, k("ArrowUp"), dims), { row: 0, col: 1 });
});

Deno.test("arrows hold at every edge instead of wrapping", () => {
	assertEquals(moveFocus({ row: 0, col: 3 }, k("ArrowRight"), dims), { row: 0, col: 3 });
	assertEquals(moveFocus({ row: 1, col: 0 }, k("ArrowLeft"), dims), { row: 1, col: 0 });
	assertEquals(moveFocus({ row: 2, col: 2 }, k("ArrowDown"), dims), { row: 2, col: 2 });
	assertEquals(moveFocus({ row: 0, col: 2 }, k("ArrowUp"), dims), { row: 0, col: 2 });
	// The key is still consumed at the edge, so the page does not scroll under the reader.
	assertEquals(matrixKeyIntent(k("ArrowRight"), { row: 0, col: 3 }, dims, () => true), {
		kind: "move",
		to: { row: 0, col: 3 },
	});
});

Deno.test("Home/End go to the ends of the current row", () => {
	assertEquals(moveFocus({ row: 2, col: 2 }, k("Home"), dims), { row: 2, col: 0 });
	assertEquals(moveFocus({ row: 2, col: 1 }, k("End"), dims), { row: 2, col: 3 });
});

Deno.test("Ctrl or Cmd + Home/End go to the ends of the grid", () => {
	assertEquals(moveFocus({ row: 2, col: 2 }, k("Home", true), dims), { row: 0, col: 0 });
	assertEquals(moveFocus({ row: 0, col: 1 }, k("End", true), dims), { row: 2, col: 3 });
	assertEquals(moveFocus({ row: 1, col: 1 }, k("End", false, true), dims), { row: 2, col: 3 });
});

Deno.test("a stale position is clamped before it moves", () => {
	assertEquals(clampPos({ row: 9, col: -2 }, dims), { row: 2, col: 0 });
	assertEquals(moveFocus({ row: 9, col: 9 }, k("ArrowLeft"), dims), { row: 2, col: 2 });
});

Deno.test("non-grid keys and empty grids are let through", () => {
	assertEquals(moveFocus({ row: 0, col: 0 }, k("Tab"), dims), null);
	assertEquals(matrixKeyIntent(k("a"), { row: 0, col: 0 }, dims, () => true), { kind: "none" });
	assertEquals(moveFocus({ row: 0, col: 0 }, k("ArrowDown"), { rows: 0, cols: 3 }), null);
	assertEquals(matrixKeyIntent(k(" "), { row: 0, col: 0 }, { rows: 0, cols: 0 }, () => true), {
		kind: "none",
	});
});

Deno.test("Space and Enter toggle a toggleable cell and refuse a locked one", () => {
	const locked = (at: { row: number; col: number }) => !(at.row === 1 && at.col === 2);
	for (const key of [" ", "Enter"]) {
		assertEquals(matrixKeyIntent(k(key), { row: 0, col: 0 }, dims, locked), {
			kind: "toggle",
			at: { row: 0, col: 0 },
		});
		assertEquals(matrixKeyIntent(k(key), { row: 1, col: 2 }, dims, locked), {
			kind: "refuse",
			at: { row: 1, col: 2 },
		});
	}
});

Deno.test("locked cells are skipped for toggle but stay focusable for reading", () => {
	const canToggle = () => false;
	// Navigation lands on them exactly as on any other cell.
	assertEquals(matrixKeyIntent(k("ArrowDown"), { row: 0, col: 0 }, dims, canToggle), {
		kind: "move",
		to: { row: 1, col: 0 },
	});
	assertEquals(matrixKeyIntent(k("Enter"), { row: 1, col: 0 }, dims, canToggle).kind, "refuse");
});

Deno.test("toggle rule: locked state, locked column and read-only all refuse", () => {
	assertEquals(cellToggleable("off", {}, true), true);
	assertEquals(cellToggleable("conditional", {}, true), true);
	assertEquals(cellToggleable("locked", {}, true), false);
	assertEquals(cellToggleable("allowed", { locked: true }, true), false);
	assertEquals(cellToggleable("allowed", {}, false), false);
});

Deno.test("pressed state and accessible name", () => {
	assertEquals(cellPressed("allowed"), "true");
	assertEquals(cellPressed("off"), "false");
	assertEquals(cellPressed("conditional"), "mixed");
	assertEquals(cellPressed("locked"), undefined);
	assertEquals(
		cellAccessibleName("Approve spend", "Admin", "Allowed"),
		"Approve spend for Admin: Allowed",
	);
});

Deno.test("rows split into consecutive group runs, indices preserved", () => {
	const runs = groupRuns([
		{ key: "a", label: "A", group: "Money" },
		{ key: "b", label: "B", group: "Money" },
		{ key: "c", label: "C" },
		{ key: "d", label: "D", group: "Money" },
	]);
	assertEquals(
		runs.map((r) => [r.group, r.rows.map((x) => x.index)]),
		[["Money", [0, 1]], [null, [2]], ["Money", [3]]],
	);
});
