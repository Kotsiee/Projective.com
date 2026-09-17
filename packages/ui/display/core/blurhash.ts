/**
 * blurhash — a BlurHash DECODER: the compact LQIP string back into pixels, and its average colour
 * back out on its own.
 *
 * **Self-contained, deliberately.** The ENCODER lives app-side (`apps/web/features/files/core/media/
 * blurhash.ts`, where uploads are read), and `packages/ui` may import neither the app nor
 * `@projective/types` — it stays copy-paste portable with preact, signals and material as its only
 * dependencies. So the twenty lines the two halves share (the base83 alphabet, the sRGB transfer
 * pair) are re-declared here rather than reached across a workspace boundary. What keeps the two from
 * drifting is not a shared module but the published format both are written to: an app-side test
 * encodes an image and decodes it through THIS module, and a hash that round-trips through a decoder
 * from a different codebase is the only proof either half is right.
 *
 * **Total, never throwing.** A hash arrives from a data row — `files.items.metadata.blurhash`, a
 * discovery fixture, a profile projection — and a malformed one must degrade to "no placeholder",
 * not to a failed render. Every function here returns `null` on input it cannot read.
 *
 * **Nothing here touches the DOM.** {@link decodeBlurHash} returns RGBA that a caller paints into a
 * canvas; {@link blurHashAverage} returns a hex string a server component writes into a custom
 * property. The second is the reason this module runs on the server at all: the DC term of a hash IS
 * the image's mean colour, four characters in, so the first byte can carry a correctly-toned ground
 * for every image on the page with no JavaScript and no decode of anything else.
 */

// #region Base83
/** The BlurHash alphabet, in value order. Position IS the digit. Must match the encoder's exactly. */
const DIGITS =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

/** Char code → digit value, built once. `-1` marks a character outside the alphabet. */
const VALUE_OF = new Int8Array(128).fill(-1);
for (let i = 0; i < DIGITS.length; i++) VALUE_OF[DIGITS.charCodeAt(i)] = i;

/** Parse `text` as big-endian base83. `null` on any character outside the alphabet. */
function decode83(text: string): number | null {
	let value = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const digit = code < 128 ? VALUE_OF[code] : -1;
		if (digit < 0) return null;
		value = value * 83 + digit;
	}
	return value;
}
// #endregion

// #region Colour transfer
/** sRGB byte → linear light. A 256-entry table, for the same reason the encoder keeps one. */
const LINEAR = new Float64Array(256);
for (let v = 0; v < 256; v++) {
	const s = v / 255;
	LINEAR[v] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Linear light → sRGB byte. `trunc(x + 0.5)`, as the format specifies, matching the encoder. */
function linearToSRGB(value: number): number {
	const v = Math.max(0, Math.min(1, value));
	return v <= 0.0031308
		? Math.trunc(v * 12.92 * 255 + 0.5)
		: Math.trunc((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
}

/** `sign(v) · |v|^exp` — the AC quantiser's inverse, kept signed so a negative lobe survives it. */
function signPow(value: number, exp: number): number {
	return Math.sign(value) * Math.pow(Math.abs(value), exp);
}
// #endregion

// #region Header
/** The component grid a hash declares, or `null` when the string is not a hash at all. */
function readHeader(hash: string): { cx: number; cy: number } | null {
	if (typeof hash !== "string" || hash.length < 6) return null;
	const sizeFlag = decode83(hash[0]);
	if (sizeFlag === null) return null;
	const cy = Math.floor(sizeFlag / 9) + 1;
	const cx = (sizeFlag % 9) + 1;
	// A hash is exactly `4 + 2 · cx · cy` characters; anything else is truncated or padded.
	if (hash.length !== 4 + 2 * cx * cy) return null;
	return { cx, cy };
}

/** The DC term — the mean colour — as linear RGB. `null` when the four digits are not base83. */
function readDC(hash: string): [number, number, number] | null {
	const value = decode83(hash.slice(2, 6));
	if (value === null) return null;
	return [LINEAR[value >> 16], LINEAR[(value >> 8) & 255], LINEAR[value & 255]];
}
// #endregion

// #region Average colour
/**
 * The hash's average colour as a lower-case `#rrggbb`, or `null` for anything that is not a hash.
 *
 * Reads only the header and the DC digits — six characters, no trigonometry — so it is safe to call
 * once per image during a server render. The result is the same `#rrggbb` spelling the metadata
 * SSOT's `HexColorSchema` mandates, so a caller may compare it for equality with a stored colour.
 */
export function blurHashAverage(hash: string | null | undefined): string | null {
	if (!hash || !readHeader(hash)) return null;
	const dc = readDC(hash);
	if (!dc) return null;
	const hex = (v: number) => linearToSRGB(v).toString(16).padStart(2, "0");
	return `#${hex(dc[0])}${hex(dc[1])}${hex(dc[2])}`;
}
// #endregion

// #region Decoder
/**
 * Decode a hash into a `width × height` RGBA buffer — row-major, four bytes per pixel, alpha 255 —
 * the shape `ImageData` takes.
 *
 * `punch` scales the AC terms: `1` is the image's own contrast, higher exaggerates it. The published
 * decoders default to 1 and so does this one.
 *
 * Returns `null` for a malformed hash or a degenerate size. Cost is `O(width · height · cx · cy)`
 * with the per-axis cosines precomputed, so a 32×32 decode of a 4×3 hash is a few thousand
 * multiplications — cheap enough to run for every placeholder on a page in one frame.
 */
export function decodeBlurHash(
	hash: string,
	width: number,
	height: number,
	punch = 1,
): Uint8ClampedArray<ArrayBuffer> | null {
	const header = readHeader(hash);
	if (!header) return null;
	const w = Math.trunc(width);
	const h = Math.trunc(height);
	if (!(w >= 1) || !(h >= 1)) return null;
	const { cx, cy } = header;

	const quantisedMax = decode83(hash[1]);
	const dc = readDC(hash);
	if (quantisedMax === null || !dc) return null;
	const maximumValue = ((quantisedMax + 1) / 166) * punch;

	// Flat coefficient triples, DC first, then each AC term in the order the encoder wrote them.
	const colors = new Float64Array(cx * cy * 3);
	colors[0] = dc[0];
	colors[1] = dc[1];
	colors[2] = dc[2];
	for (let k = 1; k < cx * cy; k++) {
		const value = decode83(hash.slice(4 + k * 2, 6 + k * 2));
		if (value === null) return null;
		const qr = Math.floor(value / (19 * 19));
		const qg = Math.floor(value / 19) % 19;
		const qb = value % 19;
		const i = k * 3;
		colors[i] = signPow((qr - 9) / 9, 2) * maximumValue;
		colors[i + 1] = signPow((qg - 9) / 9, 2) * maximumValue;
		colors[i + 2] = signPow((qb - 9) / 9, 2) * maximumValue;
	}

	// The basis is separable, so each axis's cosines are evaluated once and reused across the other.
	const cosX = new Float64Array(cx * w);
	for (let x = 0; x < cx; x++) {
		for (let i = 0; i < w; i++) cosX[x * w + i] = Math.cos((Math.PI * x * i) / w);
	}
	const cosY = new Float64Array(cy * h);
	for (let y = 0; y < cy; y++) {
		for (let j = 0; j < h; j++) cosY[y * h + j] = Math.cos((Math.PI * y * j) / h);
	}

	const pixels = new Uint8ClampedArray(w * h * 4);
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			let r = 0;
			let g = 0;
			let b = 0;
			for (let y = 0; y < cy; y++) {
				const by = cosY[y * h + j];
				for (let x = 0; x < cx; x++) {
					const basis = cosX[x * w + i] * by;
					const c = (y * cx + x) * 3;
					r += colors[c] * basis;
					g += colors[c + 1] * basis;
					b += colors[c + 2] * basis;
				}
			}
			const p = (j * w + i) * 4;
			pixels[p] = linearToSRGB(r);
			pixels[p + 1] = linearToSRGB(g);
			pixels[p + 2] = linearToSRGB(b);
			pixels[p + 3] = 255;
		}
	}
	return pixels;
}

/**
 * True when `hash` has the shape of a BlurHash — the right alphabet and a length that agrees with
 * its own size flag. The same test the decoder applies, exposed so a caller can gate a data
 * attribute on it before paying for a decode.
 */
export function isBlurHash(hash: string | null | undefined): hash is string {
	return !!hash && readHeader(hash) !== null && readDC(hash) !== null;
}
// #endregion
