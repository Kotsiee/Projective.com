import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { BlurHashSchema } from "../../types/file-types.ts";
import { componentsFor, encodeBlurHash } from "./blurhash.ts";

/**
 * The BlurHash encoder, pinned against facts that do NOT come from this encoder.
 *
 * A round-trip through a decoder written beside the encoder proves only that the two agree, and two
 * halves written from the same misunderstanding agree perfectly. So every assertion below is anchored
 * to something external: an analytically derivable hash, a structural property of the published
 * format, or a symmetry the output must have whatever the arithmetic inside is.
 *
 * ## The analytic vectors
 *
 * A 1x1 image at 1x1 components has no AC coefficients at all, so its hash is
 * `sizeFlag · maximumValue · dc` and every term is closed-form:
 *
 *  - `sizeFlag` = `(1 - 1) + (1 - 1) · 9` = 0, and base83 digit 0 is `0`.
 *  - With no AC terms the format writes a literal `0` in the maximum-value slot.
 *  - `dc` is the mean linear colour packed as 24-bit sRGB, encoded as four base83 digits.
 *
 * For solid black that is `0x000000`, so the hash is `000000`. For solid white it is `0xFFFFFF` =
 * 16777215, and `29 · 83³ + 28 · 83² + 30 · 83 + 10` = 16581823 + 192892 + 2490 + 10 = 16777215, so
 * the base83 digits are `29, 28, 30, 10` → `T`, `S`, `U`, `A` and the hash is `00TSUA`. Neither
 * literal was produced by running this code.
 *
 * ## The structural anchors
 *
 * The canonical published sample hash, `LEHV6nWB2yk8pyo0adR*.7kCMdnj`, is 28 characters long and
 * begins with `L`. Both follow from the format: a hash is `4 + 2 · cx · cy` characters, and its first
 * character is `(cx - 1) + (cy - 1) · 9` in base83 — for the 4x3 grid that sample uses, 28 and digit
 * 21, which is `L`. Any encoder that agrees with that sample's shape has the alphabet, the size flag
 * and the layout right.
 */

// #region Fixtures
/** A solid RGBA block, fully opaque. */
function solid(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = 255;
	}
	return data;
}

/** An RGBA block painted by a callback, so a test can state the image rather than fill a buffer. */
function paint(
	size: number,
	colour: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const [r, g, b] = colour(x, y);
			const p = (y * size + x) * 4;
			data[p] = r;
			data[p + 1] = g;
			data[p + 2] = b;
			data[p + 3] = 255;
		}
	}
	return data;
}

/**
 * The published base83 alphabet, transcribed here rather than imported.
 *
 * Importing the encoder's own copy would make a wrong alphabet self-consistent and invisible.
 */
const DIGITS =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

/** Read a base83 run back to its integer value. */
function decode83(text: string): number {
	let value = 0;
	for (const character of text) {
		const digit = DIGITS.indexOf(character);
		if (digit < 0) throw new Error(`"${character}" is not a base83 digit.`);
		value = value * 83 + digit;
	}
	return value;
}
// #endregion

// #region Analytic vectors
Deno.test("a 1x1 black image at 1x1 components encodes to the analytic hash 000000", () => {
	assertEquals(encodeBlurHash(solid(1, 1, 0, 0, 0), 1, 1, 1, 1), "000000");
});

Deno.test("a 1x1 white image at 1x1 components encodes to the analytic hash 00TSUA", () => {
	assertEquals(encodeBlurHash(solid(1, 1, 255, 255, 255), 1, 1, 1, 1), "00TSUA");
});

Deno.test("the DC term is the mean, so a solid colour hashes the same at any resolution", () => {
	// Not a tautology about this encoder: the DC coefficient IS defined as the mean, so a solid
	// colour must produce the identical hash whatever the sample size was. An encoder that folded a
	// resolution-dependent scale into the DC would fail here and nowhere else.
	assertEquals(
		encodeBlurHash(solid(8, 8, 255, 255, 255), 8, 8, 1, 1),
		encodeBlurHash(solid(1, 1, 255, 255, 255), 1, 1, 1, 1),
	);
});

Deno.test("a solid colour's DC decodes back to that exact colour", () => {
	const hash = encodeBlurHash(solid(4, 4, 0x3f, 0xa9, 0xf5), 4, 4, 4, 3);
	// Characters 0 and 1 are the size flag and the AC maximum; the DC is the next four.
	const dc = decode83(hash.slice(2, 6));
	assertEquals((dc >> 16) & 0xff, 0x3f);
	assertEquals((dc >> 8) & 0xff, 0xa9);
	assertEquals(dc & 0xff, 0xf5);
});
// #endregion

// #region Format structure
Deno.test("a 4x3 hash is 28 characters and begins with L, matching the canonical sample's shape", () => {
	const hash = encodeBlurHash(solid(16, 12, 90, 140, 200), 16, 12, 4, 3);
	assertEquals(hash.length, 28);
	assertEquals(hash[0], "L");
});

Deno.test("the first character encodes the component grid", () => {
	// (cx - 1) + (cy - 1) * 9, read straight back out of the hash.
	for (const [cx, cy] of [[1, 1], [2, 2], [4, 3], [4, 4], [9, 1], [1, 9]] as const) {
		const hash = encodeBlurHash(solid(8, 8, 12, 200, 90), 8, 8, cx, cy);
		assertEquals(decode83(hash[0]), cx - 1 + (cy - 1) * 9, `grid ${cx}x${cy}`);
		assertEquals(hash.length, 4 + 2 * cx * cy, `length for ${cx}x${cy}`);
	}
});

Deno.test("every hash satisfies the SSOT's charset and bounds", () => {
	const images: Array<[Uint8ClampedArray, number, number, number, number]> = [
		[solid(1, 1, 0, 0, 0), 1, 1, 1, 1],
		[solid(64, 64, 255, 255, 255), 64, 64, 9, 9],
		[paint(32, (x, y) => [x * 8, y * 8, 255 - x * 4]), 32, 32, 5, 3],
	];
	for (const [data, w, h, cx, cy] of images) {
		const hash = encodeBlurHash(data, w, h, cx, cy);
		assert(BlurHashSchema.safeParse(hash).success, `rejected: ${hash}`);
	}
});
// #endregion

// #region Symmetry
Deno.test("transposing an image transposes its coefficients", () => {
	// The strongest claim available without a second implementation: if the x and y axes were
	// swapped, or one basis were computed against the wrong dimension, a left/right split and a
	// top/bottom split of the SAME two colours could not produce hashes whose AC pairs are each
	// other's mirror.
	const size = 8;
	const left = paint(size, (x) => (x < size / 2 ? [20, 40, 200] : [240, 210, 60]));
	const top = paint(size, (_x, y) => (y < size / 2 ? [20, 40, 200] : [240, 210, 60]));

	const a = encodeBlurHash(left, size, size, 2, 2);
	const b = encodeBlurHash(top, size, size, 2, 2);

	// Same colours and the same set of coefficient magnitudes, so the flag, the AC maximum and the DC
	// are identical.
	assertEquals(a.slice(0, 6), b.slice(0, 6));
	// At 2x2 the coefficients are (0,0), (1,0), (0,1), (1,1); transposition swaps the middle pair and
	// leaves the diagonal one alone.
	assertEquals(a.slice(6, 8), b.slice(8, 10));
	assertEquals(a.slice(8, 10), b.slice(6, 8));
	assertEquals(a.slice(10, 12), b.slice(10, 12));
	assertNotEquals(a, b);
});
// #endregion

// #region Bounds and refusals
Deno.test("component counts are clamped so the hash always fits the SSOT's length bound", () => {
	// 9x9 would be 166 characters; BlurHashSchema stops at 160, so the larger axis is reduced until
	// it fits rather than the row being rejected after the work of computing it.
	const hash = encodeBlurHash(solid(16, 16, 100, 100, 100), 16, 16, 40, 40);
	assert(hash.length <= 160, `length ${hash.length}`);
	assert(BlurHashSchema.safeParse(hash).success);
});

Deno.test("a pixel buffer that disagrees with its dimensions is refused", () => {
	// Encoding it anyway would describe a different image than the caller asked about, and a
	// confidently wrong placeholder is worse than none — the extractors catch this and record it.
	assertThrows(() => encodeBlurHash(solid(4, 4, 0, 0, 0), 8, 8, 2, 2), RangeError);
	assertThrows(() => encodeBlurHash(new Uint8ClampedArray(0), 0, 0, 1, 1), RangeError);
});

Deno.test("componentsFor spends its budget on the axis with the detail in it", () => {
	assertEquals(componentsFor(800, 800), [4, 4]);
	const [wideX, wideY] = componentsFor(1920, 1080);
	assert(wideX > wideY, `expected a landscape grid, got ${wideX}x${wideY}`);
	const [tallX, tallY] = componentsFor(1080, 1920);
	assert(tallY > tallX, `expected a portrait grid, got ${tallX}x${tallY}`);
	// A degenerate size still returns a usable grid rather than zero components.
	assertEquals(componentsFor(0, 0), [4, 4]);
});
// #endregion
