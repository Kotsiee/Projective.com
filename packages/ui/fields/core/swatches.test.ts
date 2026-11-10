import { assertEquals } from "@std/assert";
import { SWATCH_COLUMNS, SWATCHES, swatchFor, swatchStep } from "./swatches.ts";

Deno.test("two rows of six, the default first and every other cell a --swatch- token", () => {
	assertEquals(SWATCHES.length, SWATCH_COLUMNS * 2);
	assertEquals(SWATCHES[0], { token: null, slug: "default", label: "Default" });
	for (const s of SWATCHES.slice(1)) assertEquals(s.token, `--swatch-${s.slug}`);
	assertEquals(new Set(SWATCHES.map((s) => s.slug)).size, SWATCHES.length);
});

Deno.test("swatchFor names the cell, and anything else is the default", () => {
	assertEquals(swatchFor("--swatch-teal").slug, "teal");
	for (const other of [null, undefined, "--primary", "--swatch-none"]) {
		assertEquals(swatchFor(other).slug, "default", String(other));
	}
});

Deno.test("swatchStep moves a cell, a row, or to the ends, wrapping, and mirrors left and right in RTL", () => {
	const last = SWATCHES.length - 1;
	assertEquals(swatchStep("ArrowRight", 0), 1);
	assertEquals(swatchStep("ArrowLeft", 0), last);
	assertEquals(swatchStep("ArrowRight", last), 0);
	assertEquals(swatchStep("ArrowDown", 2), 2 + SWATCH_COLUMNS);
	assertEquals(swatchStep("ArrowDown", 2 + SWATCH_COLUMNS), 2);
	assertEquals(swatchStep("ArrowUp", 1), 1 + SWATCH_COLUMNS);
	assertEquals(swatchStep("Home", 7), 0);
	assertEquals(swatchStep("End", 3), last);
	assertEquals(swatchStep("ArrowRight", 3, true), 2);
	assertEquals(swatchStep("Enter", 3), null);
});
