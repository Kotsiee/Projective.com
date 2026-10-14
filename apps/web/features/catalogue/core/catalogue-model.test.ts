import { assertEquals } from "@std/assert";
import { aspectFraction, cssLengthPx, halfOverHalf } from "./catalogue-model.ts";

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

// #region Grid metrics
Deno.test("cssLengthPx — px as written, rem against the root, anything else unreadable", () => {
	assertEquals(cssLengthPx("16px", 16), 16);
	assertEquals(cssLengthPx(" 7.25rem", 16), 116);
	assertEquals(cssLengthPx("1rem", 20), 20);
	assertEquals(cssLengthPx("2em", 16), null);
	assertEquals(cssLengthPx("calc(1rem + 2px)", 16), null);
	assertEquals(cssLengthPx("", 16), null);
});

Deno.test("aspectFraction — height over width of an aspect-ratio value", () => {
	assertEquals(aspectFraction("16 / 10"), 0.625);
	assertEquals(aspectFraction(" 1 "), 1);
	assertEquals(aspectFraction("4/5"), 1.25);
	assertEquals(aspectFraction("auto"), null);
	assertEquals(aspectFraction("0 / 1"), null);
});
// #endregion
