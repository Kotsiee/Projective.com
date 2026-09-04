import { assert, assertEquals } from "@std/assert";
import { ColorSummarySchema, HexColorSchema } from "../../types/file-types.ts";
import { averageColor, colorSummary, dominantColors } from "./colors.ts";

/**
 * The colour summariser, with the weighting rule pinned by its FAILURE case.
 *
 * A dominant-colour test that only checks a happy path is worth very little: almost any weighting
 * returns "blue" for a picture of the sky. The bug this module exists to avoid — weighting by relative
 * saturation `(max - min) / max` — passes every happy-path test and then returns near-black for
 * photographs with a faint cast in the shadows, which is what it did to 7 of the first 8 thumbnails on
 * the discovery grid (Decision #74).
 *
 * So the central test below builds the image that separates the two rules: a mostly-dark frame whose
 * dark pixels have a strong RELATIVE cast and whose small bright region has far more ABSOLUTE chroma.
 * Relative saturation scores the shadow 0.96 against the highlight's 0.57 and, at three times the
 * area, elects it. The rule this module implements elects the highlight. There is no weighting that
 * passes both, which is the point.
 */

// #region Fixtures
/** An RGBA block painted by a callback, fully opaque unless the callback says otherwise. */
function paint(
	width: number,
	height: number,
	colour: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = colour(x, y);
			const p = (y * width + x) * 4;
			data[p] = r;
			data[p + 1] = g;
			data[p + 2] = b;
			data[p + 3] = a;
		}
	}
	return data;
}

/** The perceived lightness of a hex colour, for asserting that an answer is not near-black. */
function lightnessOf(hex: string): number {
	const value = Number.parseInt(hex.slice(1), 16);
	return (((value >> 16) & 0xff) + ((value >> 8) & 0xff) + (value & 0xff)) / 3;
}
// #endregion

// #region The weighting rule
Deno.test("a faint cast in the shadows does not outvote a genuinely colourful highlight", () => {
	// 48 of 64 pixels are a near-black blue-green; 16 are a warm mid-tone.
	//
	//   rgb(2, 26, 50)     relative saturation (50 - 2) / 50  = 0.96
	//   rgb(210, 120, 90)  relative saturation (210 - 90) / 210 = 0.57
	//
	// Weighted by relative saturation the shadow wins 46.1 to 9.1 and the answer is a colour nobody
	// would describe the image with. Weighted by absolute chroma biased to mid-tones it loses 4.2 to
	// 6.8, which is the answer a person would give.
	const image = paint(8, 8, (_x, y) => (y < 6 ? [2, 26, 50, 255] : [210, 120, 90, 255]));
	const dominant = dominantColors(image, 3);

	assertEquals(dominant[0], "#d2785a");
	assert(
		lightnessOf(dominant[0]) > 60,
		`the dominant colour came back near-black: ${dominant[0]}`,
	);
});

Deno.test("the shadow is still reported, just not first", () => {
	// The rule ranks; it does not censor. A reader asking for three dominants gets the frame's actual
	// second colour rather than a synthetic one.
	const image = paint(8, 8, (_x, y) => (y < 6 ? [2, 26, 50, 255] : [210, 120, 90, 255]));
	const dominant = dominantColors(image, 3);
	assertEquals(dominant.length, 2);
	assertEquals(dominant[1], "#021a32");
});
// #endregion

// #region Averages
Deno.test("the average includes the extremes the vote excludes", () => {
	// Independently computed: r (48·2 + 16·210) / 64 = 54, g (48·26 + 16·120) / 64 = 49.5, b
	// (48·50 + 16·90) / 64 = 60.
	const image = paint(8, 8, (_x, y) => (y < 6 ? [2, 26, 50, 255] : [210, 120, 90, 255]));
	assertEquals(averageColor(image), "#36323c");
});

Deno.test("a fully transparent bitmap has no colours at all", () => {
	// Not `#000000`: a reader would believe that, and a black placeholder behind a cut-out logo is a
	// visible mistake rather than a missing answer.
	const image = paint(4, 4, () => [12, 200, 90, 0]);
	assertEquals(averageColor(image), null);
	assertEquals(dominantColors(image, 3), []);
	assertEquals(colorSummary(image), null);
});

Deno.test("an image made entirely of extremes falls back to its own average", () => {
	// Every pixel is skipped by the vote, so there is no bucket to elect. The mean is the honest
	// answer for something with no dominant hue — and it is an answer, not an empty array.
	const image = paint(4, 4, () => [0, 0, 0, 255]);
	assertEquals(dominantColors(image, 3), ["#000000"]);
});
// #endregion

// #region Distinctness
Deno.test("a smooth gradient reports one colour, not three shades of one colour", () => {
	const image = paint(16, 16, (x) => [60 + x, 90 + x, 180 + x, 255]);
	assertEquals(dominantColors(image, 3).length, 1);
});

Deno.test("genuinely separate colours come back separately, most prominent first", () => {
	const image = paint(9, 9, (_x, y) => {
		if (y < 5) return [200, 60, 60, 255];
		if (y < 8) return [60, 200, 60, 255];
		return [60, 60, 200, 255];
	});
	const dominant = dominantColors(image, 3);
	assertEquals(dominant, ["#c83c3c", "#3cc83c", "#3c3cc8"]);
});

Deno.test("the count is a maximum, never a quota to pad out", () => {
	const image = paint(8, 8, () => [200, 60, 60, 255]);
	assertEquals(dominantColors(image, 3).length, 1);
	assertEquals(dominantColors(image, 0), []);
});
// #endregion

// #region SSOT conformance
Deno.test("every colour is the one spelling HexColorSchema accepts", () => {
	const image = paint(16, 16, (x, y) => [x * 15, y * 15, 255 - x * 8, 255]);
	const summary = colorSummary(image);
	assert(summary !== null);
	assert(ColorSummarySchema.safeParse(summary).success);
	for (const hex of [summary.average, ...summary.dominant]) {
		assert(HexColorSchema.safeParse(hex).success, `rejected: ${hex}`);
	}
	assert(summary.dominant.length <= 3);
});
// #endregion
