import { assertEquals } from "@std/assert";
import { sweptSelection, weekdayOrder } from "./weekday-rail.ts";

const MONDAY_FIRST = weekdayOrder(1);

Deno.test("weekdayOrder starts on the week's first day and wraps", () => {
	assertEquals(MONDAY_FIRST, [1, 2, 3, 4, 5, 6, 0]);
	assertEquals(weekdayOrder(0), [0, 1, 2, 3, 4, 5, 6]);
	assertEquals(weekdayOrder(-1), [6, 0, 1, 2, 3, 4, 5]);
});

Deno.test("a sweep selects every day between where it began and where it is, either way", () => {
	assertEquals(sweptSelection([], MONDAY_FIRST, 0, 4, true, 1, 7), [1, 2, 3, 4, 5]);
	assertEquals(sweptSelection([], MONDAY_FIRST, 4, 0, true, 1, 7), [1, 2, 3, 4, 5]);
	assertEquals(sweptSelection([3], MONDAY_FIRST, 5, 6, true, 1, 7), [0, 3, 6]);
});

Deno.test("a sweep that began on a selected day clears, and moving back shrinks the run", () => {
	const base = [1, 2, 3, 4, 5];
	assertEquals(sweptSelection(base, MONDAY_FIRST, 2, 4, false, 1, 7), [1, 2]);
	assertEquals(sweptSelection(base, MONDAY_FIRST, 2, 3, false, 1, 7), [1, 2, 5]);
	assertEquals(sweptSelection(base, MONDAY_FIRST, 2, 2, false, 1, 7), [1, 2, 4, 5]);
});

Deno.test("a sweep stops short of min and max rather than breaking them", () => {
	assertEquals(sweptSelection([1, 2], MONDAY_FIRST, 0, 1, false, 1, 7), null);
	assertEquals(sweptSelection([1], MONDAY_FIRST, 1, 3, true, 0, 3), null);
	assertEquals(sweptSelection([1], MONDAY_FIRST, 1, 2, true, 0, 3), [1, 2, 3]);
});
