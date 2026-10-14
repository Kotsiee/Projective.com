import { assertEquals } from "@std/assert";
import { halfOverHalf } from "./catalogue-model.ts";

// #region halfOverHalf
Deno.test("halfOverHalf — a rise from nothing has no percentage", () => {
	// The old first-bucket formula divided by 1 here and printed 49,900%.
	assertEquals(halfOverHalf([0, 0, 0, 0, 500]), null);
});

Deno.test("halfOverHalf — fewer than two weeks has no comparison", () => {
	assertEquals(halfOverHalf([]), null);
	assertEquals(halfOverHalf([120]), null);
});

Deno.test("halfOverHalf — compares the later half with the earlier half", () => {
	assertEquals(halfOverHalf([100, 100, 150, 150]), 50);
	assertEquals(halfOverHalf([200, 200, 100, 100]), -50);
	assertEquals(halfOverHalf([80, 80]), 0);
});

Deno.test("halfOverHalf — an odd series leaves the middle week out of both halves", () => {
	// Weeks 0–1 against weeks 3–4; the 9,000 in week 2 belongs to neither.
	assertEquals(halfOverHalf([100, 100, 9_000, 100, 100]), 0);
});
// #endregion
