import { assertEquals } from "@std/assert";
import { isEmojiGridKey, layoutEmojiRows, moveInEmojiGrid } from "./emoji-grid.ts";

// Two sections of 5 and 3 cells at 4 columns:
//   row 0: 0 1 2 3
//   row 1: 4
//   row 2: 5 6 7
const rows = layoutEmojiRows([5, 3], 4);

Deno.test("each section starts a new row", () => {
	assertEquals(rows, [
		{ start: 0, length: 4 },
		{ start: 4, length: 1 },
		{ start: 5, length: 3 },
	]);
	assertEquals(layoutEmojiRows([], 8), []);
	assertEquals(layoutEmojiRows([0, 2], 8), [{ start: 0, length: 2 }]);
});

Deno.test("Up/Down keep the column and clamp to a shorter row", () => {
	assertEquals(moveInEmojiGrid(rows, 3, "ArrowDown"), 4);
	assertEquals(moveInEmojiGrid(rows, 4, "ArrowDown"), 5);
	assertEquals(moveInEmojiGrid(rows, 7, "ArrowUp"), 4);
	assertEquals(moveInEmojiGrid(rows, 4, "ArrowUp"), 0);
	assertEquals(moveInEmojiGrid(rows, 2, "ArrowUp"), "exit-top");
	assertEquals(moveInEmojiGrid(rows, 6, "ArrowDown"), 6);
});

Deno.test("Left/Right follow reading order and stop at the ends", () => {
	assertEquals(moveInEmojiGrid(rows, 3, "ArrowRight"), 4);
	assertEquals(moveInEmojiGrid(rows, 5, "ArrowLeft"), 4);
	assertEquals(moveInEmojiGrid(rows, 0, "ArrowLeft"), 0);
	assertEquals(moveInEmojiGrid(rows, 7, "ArrowRight"), 7);
});

Deno.test("Home/End go to the row ends, or the grid ends with toEdge", () => {
	assertEquals(moveInEmojiGrid(rows, 6, "Home"), 5);
	assertEquals(moveInEmojiGrid(rows, 1, "End"), 3);
	assertEquals(moveInEmojiGrid(rows, 6, "Home", true), 0);
	assertEquals(moveInEmojiGrid(rows, 1, "End", true), 7);
});

Deno.test("an out-of-range index is clamped and an empty grid stays put", () => {
	assertEquals(moveInEmojiGrid(rows, 99, "ArrowLeft"), 6);
	assertEquals(moveInEmojiGrid([], 0, "ArrowDown"), 0);
	assertEquals(isEmojiGridKey("ArrowUp"), true);
	assertEquals(isEmojiGridKey("Enter"), false);
});
