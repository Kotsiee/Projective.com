/**
 * The grid backdrop's colour normalisation.
 *
 * This is worth testing precisely because it fails SILENTLY: a colour the parser mishandles is
 * handed to the 2D context, which rejects it without an error and keeps whatever `fillStyle` it had
 * — so a wrong parse shows up as lines painted in the previous shape's colour, or in no colour at
 * all, and never as an exception. The `color(srgb …)` case is the load-bearing one: this app
 * generates its palette through the Material colour engine, and `getComputedStyle` returns exactly
 * that notation for a resolved `color-mix()`, which is what every value the backdrop draws with is.
 */
import { assertEquals } from "@std/assert";
import { parseCssColor, toCanvasColor } from "./grid-paint.ts";

Deno.test("parseCssColor — color(srgb …) with 0–1 components scales to canvas channels", () => {
	assertEquals(parseCssColor("color(srgb 0 0.5 1)"), { r: 0, g: 128, b: 255, a: 1 });
});

Deno.test("parseCssColor — color(srgb …) carries the slash alpha a color-mix leaves behind", () => {
	assertEquals(parseCssColor("color(srgb 1 0 0 / 0.12)"), { r: 255, g: 0, b: 0, a: 0.12 });
});

Deno.test("parseCssColor — a percentage alpha is the same fraction as a number", () => {
	assertEquals(parseCssColor("color(srgb 0 0 0 / 12%)")?.a, 0.12);
	assertEquals(parseCssColor("rgb(0 0 0 / 50%)")?.a, 0.5);
});

Deno.test("parseCssColor — percentage components resolve against their own notation's full scale", () => {
	// 1 in `color(srgb …)`, 255 in `rgb()` — the same token means two different numbers.
	assertEquals(parseCssColor("color(srgb 100% 0% 0%)"), { r: 255, g: 0, b: 0, a: 1 });
	assertEquals(parseCssColor("rgb(100% 0% 0%)"), { r: 255, g: 0, b: 0, a: 1 });
});

Deno.test("parseCssColor — the legacy comma form keeps its fourth positional token as alpha", () => {
	assertEquals(parseCssColor("rgba(10, 20, 30, 0.4)"), { r: 10, g: 20, b: 30, a: 0.4 });
	assertEquals(parseCssColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 });
});

Deno.test("parseCssColor — hex in all four lengths, short digits doubled not padded", () => {
	assertEquals(parseCssColor("#0f8"), { r: 0, g: 255, b: 136, a: 1 });
	assertEquals(parseCssColor("#0f8f"), { r: 0, g: 255, b: 136, a: 1 });
	assertEquals(parseCssColor("#0088ff"), { r: 0, g: 136, b: 255, a: 1 });
	assertEquals(parseCssColor("#0088ff00"), { r: 0, g: 136, b: 255, a: 0 });
});

Deno.test("parseCssColor — `transparent` is a real answer, not a failure", () => {
	// It has to parse: a token that mixes to nothing is exactly what an unset overlay resolves to,
	// and returning null there would send the literal word to the canvas instead.
	assertEquals(parseCssColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
});

Deno.test("parseCssColor — a missing component composites as zero rather than as NaN", () => {
	assertEquals(parseCssColor("color(srgb none 0.5 0.5)")?.r, 0);
});

Deno.test("parseCssColor — out-of-gamut and out-of-range values are clamped, never wrapped", () => {
	assertEquals(parseCssColor("color(srgb 1.4 -0.2 0.5)"), { r: 255, g: 0, b: 128, a: 1 });
	assertEquals(parseCssColor("rgb(300 -5 0 / 2)")?.a, 1);
});

Deno.test("parseCssColor — declines a notation it does not understand instead of guessing", () => {
	// Every one of these is a colour the 2D context may well accept on its own; the parser's job is
	// to get out of the way, not to substitute an approximation.
	assertEquals(parseCssColor("rebeccapurple"), null);
	assertEquals(parseCssColor("color(display-p3 1 0 0)"), null);
	assertEquals(parseCssColor("hsl(200 50% 50%)"), null);
	assertEquals(parseCssColor(""), null);
	assertEquals(parseCssColor("#12345"), null);
});

Deno.test("toCanvasColor — normalises to the rgba() form every 2D context parses", () => {
	assertEquals(toCanvasColor("color(srgb 0 0.5 1 / 0.2)"), "rgba(0, 128, 255, 0.2)");
	assertEquals(toCanvasColor("#0088ff"), "rgba(0, 136, 255, 1)");
});

Deno.test("toCanvasColor — passes an unrecognised notation through untouched", () => {
	assertEquals(toCanvasColor(" rebeccapurple "), "rebeccapurple");
});
