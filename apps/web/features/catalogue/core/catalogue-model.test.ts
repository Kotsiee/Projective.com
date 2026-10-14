import { assertEquals } from "@std/assert";
import { aspectFraction, cssLengthPx } from "./catalogue-model.ts";

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
