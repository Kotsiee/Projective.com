import { assertEquals } from "@std/assert";
import {
	clampRatio,
	clockLabel,
	controlsVisible,
	hasDuration,
	isPlayableSource,
	nextRate,
	pointerRatio,
	progressRatio,
	rateLabel,
	seekValueText,
	SLIDER_KEY_STEP,
	SLIDER_PAGE_STEP,
	stepRatio,
	volumeGlyph,
} from "./video.ts";

/**
 * Tests for the video player's pure rules. Each is a CLAIM the surface makes to a reader — that a
 * paused frame shows its controls, that a tap reveals them, that the scrubber says a time and not
 * a percentage — and the failure mode of an unchecked one is a confident wrong statement rather
 * than a broken layout, which is why they are pinned here and not watched in a browser.
 */

// #region Source
Deno.test("isPlayableSource — a real URL plays; nothing, an empty string and the stub `#` do not", () => {
	assertEquals(isPlayableSource("https://cdn.example/reel.mp4"), true);
	assertEquals(isPlayableSource("/media/clip.webm"), true);
	assertEquals(isPlayableSource(undefined), false);
	assertEquals(isPlayableSource(""), false);
	assertEquals(isPlayableSource("#"), false);
});
// #endregion

// #region Visibility
const rest = {
	hover: false,
	focusWithin: false,
	playing: true,
	tapped: false,
	dragging: false,
} as const;

Deno.test("controlsVisible — hover, focus, a tap and a held drag each reveal both variants", () => {
	for (const variant of ["compact", "full"] as const) {
		assertEquals(controlsVisible({ ...rest, variant }), false, `${variant} at rest, playing`);
		assertEquals(controlsVisible({ ...rest, variant, hover: true }), true, `${variant} hover`);
		assertEquals(
			controlsVisible({ ...rest, variant, focusWithin: true }),
			true,
			`${variant} focus`,
		);
		assertEquals(controlsVisible({ ...rest, variant, tapped: true }), true, `${variant} tap`);
		assertEquals(controlsVisible({ ...rest, variant, dragging: true }), true, `${variant} drag`);
	}
});

Deno.test("controlsVisible — only the full transport shows while the video is not playing", () => {
	// A paused hero frame reads as a still; the bar is what says otherwise.
	assertEquals(controlsVisible({ ...rest, variant: "full", playing: false }), true);
	// A tile that has not been started is media only — the caption's own rule.
	assertEquals(controlsVisible({ ...rest, variant: "compact", playing: false }), false);
});
// #endregion

// #region Sliders
Deno.test("clampRatio — bounds the range and turns a zero-width NaN into 0", () => {
	assertEquals(clampRatio(-0.2), 0);
	assertEquals(clampRatio(1.7), 1);
	assertEquals(clampRatio(0.42), 0.42);
	assertEquals(clampRatio(NaN), 0);
	assertEquals(clampRatio(Infinity), 0);
});

Deno.test("pointerRatio — the pointer's share of the track, mirrored under RTL", () => {
	assertEquals(pointerRatio(125, 100, 100, false), 0.25);
	// Under dir="rtl" the track BEGINS at its right edge, so the same pointer names 75%.
	assertEquals(pointerRatio(125, 100, 100, true), 0.75);
	// Past either end clamps rather than overshoots.
	assertEquals(pointerRatio(50, 100, 100, false), 0);
	assertEquals(pointerRatio(260, 100, 100, false), 1);
	// A track that has not been laid out yet has no width; the seek is a no-op at 0.
	assertEquals(pointerRatio(125, 100, 0, false), 0);
});

Deno.test("stepRatio — arrows step, pages page, Home/End jump, other keys are left alone", () => {
	assertEquals(stepRatio(0.5, "ArrowRight"), 0.5 + SLIDER_KEY_STEP);
	assertEquals(stepRatio(0.5, "ArrowUp"), 0.5 + SLIDER_KEY_STEP);
	assertEquals(stepRatio(0.5, "ArrowLeft"), 0.5 - SLIDER_KEY_STEP);
	assertEquals(stepRatio(0.5, "ArrowDown"), 0.5 - SLIDER_KEY_STEP);
	assertEquals(stepRatio(0.5, "PageUp"), 0.5 + SLIDER_PAGE_STEP);
	assertEquals(stepRatio(0.5, "PageDown"), 0.5 - SLIDER_PAGE_STEP);
	assertEquals(stepRatio(0.5, "Home"), 0);
	assertEquals(stepRatio(0.5, "End"), 1);
	assertEquals(stepRatio(0.98, "ArrowRight"), 1);
	assertEquals(stepRatio(0.02, "ArrowLeft"), 0);
	assertEquals(stepRatio(0.5, "Enter"), null);
	assertEquals(stepRatio(0.5, " "), null);
	assertEquals(stepRatio(0.5, "Tab"), null);
});
// #endregion

// #region Rate
Deno.test("nextRate — cycles the list and wraps; an unknown current restarts at the first", () => {
	assertEquals(nextRate([1, 1.5, 2], 1), 1.5);
	assertEquals(nextRate([1, 1.5, 2], 1.5), 2);
	assertEquals(nextRate([1, 1.5, 2], 2), 1);
	assertEquals(nextRate([1, 1.5, 2], 0.75), 1);
	assertEquals(nextRate([], 1), 1);
	assertEquals(rateLabel(1), "1×");
	assertEquals(rateLabel(1.5), "1.5×");
});
// #endregion

// #region Labels
Deno.test("volumeGlyph — silent is struck through, whether muted or at zero", () => {
	assertEquals(volumeGlyph(true, 0.8), "volume-off");
	assertEquals(volumeGlyph(false, 0), "volume-off");
	assertEquals(volumeGlyph(false, 0.3), "volume");
	assertEquals(volumeGlyph(false, 1), "volume");
});

Deno.test("clockLabel / seekValueText — a time against the duration, the elapsed alone before it", () => {
	assertEquals(clockLabel(34, 124), "0:34 / 2:04");
	assertEquals(seekValueText(34, 124), "0:34 of 2:04");
	// Metadata not yet reported: no duration to promise.
	assertEquals(clockLabel(3, NaN), "0:03");
	assertEquals(seekValueText(3, NaN), "0:03");
	// A live stream reports Infinity, which is not a duration a clock can print.
	assertEquals(clockLabel(3, Infinity), "0:03");
	// A negative or NaN clock is 0, never a minus sign.
	assertEquals(clockLabel(-1, 60), "0:00 / 1:00");
	assertEquals(clockLabel(NaN, 60), "0:00 / 1:00");
});

Deno.test("progressRatio / hasDuration — the fill is 0 until there is a duration to divide by", () => {
	assertEquals(hasDuration(124), true);
	assertEquals(hasDuration(0), false);
	assertEquals(hasDuration(NaN), false);
	assertEquals(hasDuration(Infinity), false);
	assertEquals(progressRatio(62, 124), 0.5);
	assertEquals(progressRatio(200, 124), 1);
	assertEquals(progressRatio(62, NaN), 0);
});
// #endregion
