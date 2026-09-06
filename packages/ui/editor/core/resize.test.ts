import { assertEquals } from "@std/assert";
import {
	availableInlineSize,
	clampSize,
	cssLength,
	inlineDelta,
	KEY_STEP_COARSE_PX,
	KEY_STEP_PX,
	keyResize,
	usedPx,
} from "./resize.ts";

/**
 * Tests for the resize arithmetic.
 *
 * A drag cannot be watched here — its behaviour needs a real pointer and a composited frame, and this
 * repo has measured a preview pane that delivers neither. So everything decidable from numbers is
 * decided in this module and asserted directly, and the hook is left holding only event plumbing that
 * has no arithmetic left to get wrong.
 *
 * The direction cases carry the most weight. A resize that assumes left-to-right is not visibly
 * broken in the language it was written in, and the bug only ever appears to somebody reading in the
 * other direction — which is exactly the kind of defect a test has to catch, because no amount of
 * looking at the screen will.
 */

// #region Lengths
Deno.test("cssLength treats a bare number as pixels and passes a string through", () => {
	assertEquals(cssLength(160), "160px");
	assertEquals(cssLength(0), "0px");
	assertEquals(cssLength("20rem"), "20rem");
	assertEquals(cssLength("min(50vh, 400px)"), "min(50vh, 400px)");
});

Deno.test("usedPx reads a computed length and falls back on the values that mean 'unset'", () => {
	assertEquals(usedPx("160px", 0), 160);
	assertEquals(usedPx("12.5px", 0), 12.5);
	// `none` is what `getComputedStyle` reports for an unset `max-*`, and it means no ceiling.
	assertEquals(usedPx("none", Infinity), Infinity);
	assertEquals(usedPx("auto", 40), 40);
	assertEquals(usedPx("", 40), 40);
	assertEquals(usedPx(null, 40), 40);
	assertEquals(usedPx(undefined, 40), 40);
	assertEquals(usedPx("not-a-length", 40), 40);
});

Deno.test("clampSize honours both bounds and treats Infinity as no ceiling", () => {
	assertEquals(clampSize(200, 100, 400), 200);
	assertEquals(clampSize(50, 100, 400), 100);
	assertEquals(clampSize(900, 100, 400), 400);
	assertEquals(clampSize(9000, 100, Infinity), 9000);
	// A contradictory pair resolves toward the floor: a box may not be smaller than its minimum.
	assertEquals(clampSize(300, 400, 100), 400);
	assertEquals(clampSize(Number.NaN, 100, 400), 100);
});
// #endregion

// #region Geometry
Deno.test("availableInlineSize takes the parent's padding off its client box", () => {
	assertEquals(availableInlineSize(1000, 24, 24), 952);
	assertEquals(availableInlineSize(600, 0, 0), 600);
	// A parent narrower than its own padding cannot yield a usable width; the client box is the
	// honest answer, and it is still a ceiling rather than no ceiling at all.
	assertEquals(availableInlineSize(30, 24, 24), 30);
});

Deno.test("inlineDelta mirrors with the reading direction", () => {
	// The handle is at the physical right in LTR, so rightward travel grows the box…
	assertEquals(inlineDelta(40, false), 40);
	assertEquals(inlineDelta(-40, false), -40);
	// …and at the physical left in RTL, where the same travel shrinks it.
	assertEquals(inlineDelta(40, true), -40);
	assertEquals(inlineDelta(-40, true), 40);
});
// #endregion

// #region Keyboard
Deno.test("a block handle answers only the vertical arrows", () => {
	assertEquals(keyResize("ArrowDown", "block"), { block: KEY_STEP_PX, inline: 0 });
	assertEquals(keyResize("ArrowUp", "block"), { block: -KEY_STEP_PX, inline: 0 });
	assertEquals(keyResize("ArrowRight", "block"), null);
	assertEquals(keyResize("ArrowLeft", "block"), null);
});

Deno.test("an inline handle answers only the horizontal arrows, in reading order", () => {
	assertEquals(keyResize("ArrowRight", "inline"), { block: 0, inline: KEY_STEP_PX });
	assertEquals(keyResize("ArrowLeft", "inline"), { block: 0, inline: -KEY_STEP_PX });
	// Same key, opposite growth: ArrowRight moves toward the box's own edge in RTL, not away from it.
	assertEquals(keyResize("ArrowRight", "inline", { rtl: true }), {
		block: 0,
		inline: -KEY_STEP_PX,
	});
	assertEquals(keyResize("ArrowLeft", "inline", { rtl: true }), { block: 0, inline: KEY_STEP_PX });
	assertEquals(keyResize("ArrowDown", "inline"), null);
});

Deno.test("a corner handle answers both pairs", () => {
	assertEquals(keyResize("ArrowDown", "both"), { block: KEY_STEP_PX, inline: 0 });
	assertEquals(keyResize("ArrowRight", "both"), { block: 0, inline: KEY_STEP_PX });
});

Deno.test("Shift is the coarse step", () => {
	assertEquals(keyResize("ArrowDown", "block", { coarse: true }), {
		block: KEY_STEP_COARSE_PX,
		inline: 0,
	});
	assertEquals(keyResize("ArrowLeft", "inline", { coarse: true }), {
		block: 0,
		inline: -KEY_STEP_COARSE_PX,
	});
});

Deno.test("every other key returns null, so the handle traps nothing", () => {
	// A handle that swallowed every keystroke would take Tab and Escape with it, and a focusable
	// control nobody can leave is worse than one nobody can operate.
	for (const key of ["Tab", "Escape", "Enter", " ", "a", "Home", "PageDown"]) {
		assertEquals(keyResize(key, "both"), null, `expected ${key} to pass through`);
	}
});
// #endregion
