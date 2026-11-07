import { assertEquals } from "@std/assert";
import {
	cellAddress,
	columnEdges,
	columnSpan,
	fitColumnWidths,
	moveCursor,
	rowSpan,
	selectionBox,
	selectionText,
	type SheetBounds,
	type SheetCursor,
} from "./sheet-window.ts";

const press = (key: string, extra: { shift?: boolean; ctrl?: boolean } = {}) => ({
	key,
	shiftKey: extra.shift ?? false,
	ctrlKey: extra.ctrl ?? false,
	metaKey: false,
});

const BOUNDS: SheetBounds = { rows: 100, columns: 10, page: 20 };
const at = (row: number, column: number): SheetCursor => ({
	anchor: { row, column },
	focus: { row, column },
});

Deno.test("the row window covers the viewport plus its margin, and stays in range", () => {
	assertEquals(rowSpan(0, 300, 1000, 30, 2), { first: 0, last: 12 });
	assertEquals(rowSpan(3000, 300, 1000, 30, 2), { first: 98, last: 112 });
	assertEquals(rowSpan(29_900, 300, 1000, 30, 2), { first: 994, last: 999 });
	assertEquals(rowSpan(0, 300, 0), { first: 0, last: -1 });
	assertEquals(rowSpan(99_999, 300, 10, 30, 2), { first: 9, last: 9 });
});

Deno.test("the column window follows uneven widths", () => {
	const edges = columnEdges([100, 300, 50, 50, 200]);
	assertEquals(edges, [0, 100, 400, 450, 500, 700]);
	assertEquals(columnSpan(edges, 0, 100, 0), { first: 0, last: 1 });
	assertEquals(columnSpan(edges, 420, 40, 0), { first: 2, last: 3 });
	assertEquals(columnSpan(edges, 690, 500, 0), { first: 4, last: 4 });
	assertEquals(columnSpan([0], 0, 100), { first: 0, last: -1 });
});

Deno.test("a column takes the file's width, else one fitted to its text, within limits", () => {
	const rows = [["a", "x".repeat(10), "y".repeat(500)]];
	assertEquals(fitColumnWidths(rows, 3), [64, 103, 320]);
	assertEquals(fitColumnWidths(rows, 3, [200, null, 0]), [200, 103, 0]);
});

Deno.test("the arrows step and stop at the edges", () => {
	assertEquals(moveCursor(at(5, 5), press("ArrowDown"), BOUNDS)?.focus, { row: 6, column: 5 });
	assertEquals(moveCursor(at(0, 0), press("ArrowUp"), BOUNDS)?.focus, { row: 0, column: 0 });
	assertEquals(moveCursor(at(99, 9), press("ArrowRight"), BOUNDS)?.focus, { row: 99, column: 9 });
});

Deno.test("ctrl jumps to the edge, and page keys move by a screen", () => {
	assertEquals(moveCursor(at(5, 5), press("ArrowDown", { ctrl: true }), BOUNDS)?.focus.row, 99);
	assertEquals(moveCursor(at(5, 5), press("Home", { ctrl: true }), BOUNDS)?.focus, {
		row: 0,
		column: 0,
	});
	assertEquals(moveCursor(at(5, 5), press("End"), BOUNDS)?.focus, { row: 5, column: 9 });
	assertEquals(moveCursor(at(5, 5), press("PageDown"), BOUNDS)?.focus.row, 25);
});

Deno.test("shift extends from the anchor; a plain move collapses the selection", () => {
	const extended = moveCursor(at(2, 2), press("ArrowRight", { shift: true }), BOUNDS);
	assertEquals(extended, { anchor: { row: 2, column: 2 }, focus: { row: 2, column: 3 } });
	const again = moveCursor(extended, press("ArrowDown", { shift: true }), BOUNDS);
	assertEquals(again?.anchor, { row: 2, column: 2 });
	assertEquals(again?.focus, { row: 3, column: 3 });
	const plain = moveCursor(again, press("ArrowDown"), BOUNDS);
	assertEquals(plain?.anchor, plain?.focus);
});

Deno.test("the first move lands on the first step from A1, and other keys are not moves", () => {
	assertEquals(moveCursor(null, press("ArrowDown"), BOUNDS)?.focus, { row: 1, column: 0 });
	assertEquals(moveCursor(at(1, 1), press("x"), BOUNDS), null);
	assertEquals(moveCursor(null, press("ArrowDown"), { rows: 0, columns: 0, page: 1 }), null);
});

Deno.test("a selection normalises to its box, in whichever direction it was dragged", () => {
	assertEquals(
		selectionBox({ anchor: { row: 5, column: 1 }, focus: { row: 2, column: 4 } }),
		{ top: 2, left: 1, bottom: 5, right: 4 },
	);
});

Deno.test("addresses read the way a spreadsheet writes them", () => {
	assertEquals(cellAddress(0, 0), "A1");
	assertEquals(cellAddress(9, 27), "AB10");
});

Deno.test("a copied selection follows the view's order, not the file's", () => {
	const rows = [["a", "b"], ["c", "d"], ["e", "f"]];
	assertEquals(
		selectionText(rows, [2, 0], { top: 0, left: 0, bottom: 1, right: 1 }),
		"e\tf\na\tb",
	);
});
