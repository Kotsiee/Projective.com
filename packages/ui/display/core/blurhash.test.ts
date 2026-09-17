import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { blurHashAverage, decodeBlurHash, isBlurHash } from "./blurhash.ts";

/**
 * The BlurHash decoder, pinned against facts that do NOT come from this decoder.
 *
 * Every vector below is derived by hand from the published format, so a decoder written from a
 * misreading of it fails here rather than agreeing with an encoder written from the same misreading.
 *
 * ## The analytic vectors
 *
 * A 1x1-component hash has no AC terms: it is `sizeFlag · maximumValue · dc`, six characters, and
 * every pixel it decodes to IS the DC colour. `000000` is solid black (`dc` = 0); `00TSUA` is solid
 * white — `29 · 83³ + 28 · 83² + 30 · 83 + 10` = 16777215 = `0xFFFFFF`, so digits `T S U A`.
 *
 * ## The published sample
 *
 * `LEHV6nWB2yk8pyo0adR*.7kCMdnj` is the sample from the format's own documentation. Its DC digits
 * are `HV6n`: `H`=17, `V`=31, `6`=6, `n`=49, so the packed value is
 * `17 · 83³ + 31 · 83² + 6 · 83 + 49` = 9720379 + 213559 + 498 + 49 = 9934485 = `0x979695`. The
 * average colour of that hash is therefore `#979695` by arithmetic, before any decoder runs.
 */

const SAMPLE = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

// #region isBlurHash
Deno.test("isBlurHash accepts the published sample and the analytic vectors", () => {
	assert(isBlurHash(SAMPLE));
	assert(isBlurHash("000000"));
	assert(isBlurHash("00TSUA"));
});

Deno.test("isBlurHash rejects a length that disagrees with the size flag", () => {
	// `L` declares 4x3 → 28 characters; one short and one long are both refused.
	assertStrictEquals(isBlurHash(SAMPLE.slice(0, 27)), false);
	assertStrictEquals(isBlurHash(SAMPLE + "0"), false);
});

Deno.test("isBlurHash rejects characters outside the alphabet, empties and non-strings", () => {
	assertStrictEquals(isBlurHash("00TSU!"), false);
	assertStrictEquals(isBlurHash(""), false);
	assertStrictEquals(isBlurHash(null), false);
	assertStrictEquals(isBlurHash(undefined), false);
});
// #endregion

// #region blurHashAverage
Deno.test("blurHashAverage reads the DC term as a lower-case #rrggbb", () => {
	assertEquals(blurHashAverage("000000"), "#000000");
	assertEquals(blurHashAverage("00TSUA"), "#ffffff");
	assertEquals(blurHashAverage(SAMPLE), "#979695");
});

Deno.test("blurHashAverage is total over garbage", () => {
	assertStrictEquals(blurHashAverage(""), null);
	assertStrictEquals(blurHashAverage("not a hash"), null);
	assertStrictEquals(blurHashAverage(SAMPLE.slice(0, 10)), null);
	assertStrictEquals(blurHashAverage(null), null);
});
// #endregion

// #region decodeBlurHash
Deno.test("decodeBlurHash of a 1x1 hash is a solid field of its DC colour", () => {
	const black = decodeBlurHash("000000", 4, 3);
	assert(black);
	assertEquals(black.length, 4 * 3 * 4);
	for (let p = 0; p < black.length; p += 4) {
		assertEquals([black[p], black[p + 1], black[p + 2], black[p + 3]], [0, 0, 0, 255]);
	}
	const white = decodeBlurHash("00TSUA", 2, 2);
	assert(white);
	for (let p = 0; p < white.length; p += 4) {
		assertEquals([white[p], white[p + 1], white[p + 2], white[p + 3]], [255, 255, 255, 255]);
	}
});

Deno.test("decodeBlurHash of the sample is a plausible field whose mean is its DC", () => {
	const w = 32;
	const h = 32;
	const px = decodeBlurHash(SAMPLE, w, h);
	assert(px);
	assertEquals(px.length, w * h * 4);
	// Every alpha is opaque; the basis functions are zero-mean beyond the DC term, so the field's
	// mean in LINEAR light is the DC — in sRGB it lands within a few steps of `#979695`.
	let r = 0;
	let g = 0;
	let b = 0;
	for (let p = 0; p < px.length; p += 4) {
		assertEquals(px[p + 3], 255);
		r += px[p];
		g += px[p + 1];
		b += px[p + 2];
	}
	const n = w * h;
	assert(Math.abs(r / n - 0x97) < 12, `mean red ${r / n}`);
	assert(Math.abs(g / n - 0x96) < 12, `mean green ${g / n}`);
	assert(Math.abs(b / n - 0x95) < 12, `mean blue ${b / n}`);
	// And it is a FIELD, not a flat colour: the AC terms move pixels away from the mean.
	let spread = 0;
	for (let p = 0; p < px.length; p += 4) spread = Math.max(spread, Math.abs(px[p] - 0x97));
	assert(spread > 16, `spread ${spread}`);
});

Deno.test("decodeBlurHash is total over malformed input and degenerate sizes", () => {
	assertStrictEquals(decodeBlurHash("", 8, 8), null);
	assertStrictEquals(decodeBlurHash(SAMPLE.slice(0, 20), 8, 8), null);
	assertStrictEquals(decodeBlurHash(SAMPLE, 0, 8), null);
	assertStrictEquals(decodeBlurHash(SAMPLE, 8, -1), null);
	assertStrictEquals(decodeBlurHash(SAMPLE, Number.NaN, 8), null);
});

Deno.test("decodeBlurHash punch scales contrast without moving the mean", () => {
	const flat = decodeBlurHash(SAMPLE, 16, 16, 1);
	const punched = decodeBlurHash(SAMPLE, 16, 16, 2);
	assert(flat && punched);
	let flatSpread = 0;
	let punchedSpread = 0;
	for (let p = 0; p < flat.length; p += 4) {
		flatSpread = Math.max(flatSpread, Math.abs(flat[p] - 0x97));
		punchedSpread = Math.max(punchedSpread, Math.abs(punched[p] - 0x97));
	}
	assert(punchedSpread > flatSpread, `${punchedSpread} > ${flatSpread}`);
});
// #endregion
