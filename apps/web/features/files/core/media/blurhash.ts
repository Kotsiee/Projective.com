/**
 * blurhash — a hand-written BlurHash encoder: the compact LQIP placeholder a grid paints while the
 * real bytes are still travelling.
 *
 * **Written here rather than pulled from npm.** `packages/types` depends on exactly one package, the
 * app's dependency surface is deliberately small, and the whole algorithm is ~120 lines of arithmetic
 * with no I/O and no platform surface. The repo's precedent for this class of work is
 * `AmbientPalette.island.tsx`, which hand-rolls dominant-colour extraction for the same reason. A
 * dependency here would buy nothing and would have to be audited, versioned and shipped to every
 * browser that uploads a photograph.
 *
 * The output is byte-compatible with the published BlurHash format, which is what makes it worth
 * having: any decoder — a CSS `background-image` shim, a native client, someone else's library — can
 * read a string this produces. Two structural facts fall out of the format and both are asserted in
 * `blurhash_test.ts`, because they are the cheapest cross-implementation checks that exist:
 * a hash is `4 + 2 · cx · cy` characters long, and its first character encodes the component counts
 * (`(cx - 1) + (cy - 1) · 9` in base83 — so the canonical 4x3 hash begins `L` and is 28 characters).
 *
 * **Nothing here touches the DOM, decodes a file or allocates per pixel.** It takes RGBA that a
 * caller already has and returns a string; every failure it can have is a programming error in its
 * arguments, which is why those are the only conditions it throws on. The extractors that call it
 * catch, because an upload must never fail for a placeholder's sake.
 */

// #region Base83
/**
 * The BlurHash alphabet, in value order. Position IS the digit — index 29 is `T`, and that is the
 * whole encoding.
 *
 * Every character is inside `BlurHashSchema`'s charset by construction, so a hash this module
 * produces cannot fail the SSOT's regex.
 */
const DIGITS =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

/** Render `value` as exactly `length` base83 digits, most significant first. */
function encode83(value: number, length: number): string {
	let result = "";
	for (let i = 1; i <= length; i++) {
		const digit = Math.floor(value / Math.pow(83, length - i)) % 83;
		result += DIGITS[digit];
	}
	return result;
}
// #endregion

// #region Colour transfer
/**
 * The sRGB electro-optical transfer function, as a 256-entry table.
 *
 * A table rather than a call because the naive encoder evaluates this once per pixel PER COMPONENT —
 * a 64x64 sample at 4x4 components is 196,608 `Math.pow` calls for 65,536 distinct inputs, and the
 * inputs are integers 0..255. `Uint8ClampedArray` guarantees that domain, so the table is exact
 * rather than approximate.
 */
const LINEAR = new Float64Array(256);
for (let v = 0; v < 256; v++) {
	const s = v / 255;
	LINEAR[v] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Linear light back to an sRGB byte.
 *
 * `Math.trunc(x + 0.5)` rather than `Math.round(x)` because that is what the format specifies, and
 * the two disagree on negative halves. The input is clamped first, so the disagreement is
 * unreachable — the truncation is kept because matching the specification exactly is the only reason
 * anyone else's decoder can read this.
 */
function linearToSRGB(value: number): number {
	const v = Math.max(0, Math.min(1, value));
	return v <= 0.0031308
		? Math.trunc(v * 12.92 * 255 + 0.5)
		: Math.trunc((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
}

/** `sign(v) · |v|^exp` — the AC quantiser's square root, kept signed so a negative lobe survives it. */
function signPow(value: number, exp: number): number {
	return Math.sign(value) * Math.pow(Math.abs(value), exp);
}
// #endregion

// #region Component bounds
/** The format's own per-axis limit: the size flag is one base83 digit over a 9x9 grid. */
const MAX_COMPONENTS = 9;

/**
 * The longest hash `BlurHashSchema` will accept, in characters.
 *
 * Enforced here rather than discovered at the Zod boundary: a 9x9 hash is 166 characters and would be
 * rejected by the SSOT after the work of computing it, on the one asset whose aspect ratio happened
 * to ask for it. Clamping is deterministic and explained (see {@link resolveComponents}); failing
 * validation is neither.
 */
const MAX_HASH_LENGTH = 160;

/**
 * Clamp a requested component grid into something both the format and the SSOT accept.
 *
 * Each axis is clamped to 1..9 first, then the LARGER axis is reduced until the encoded length fits.
 * Reducing the larger one keeps the grid as close to the caller's aspect intent as the bound allows —
 * shrinking the short axis of a panorama would spend the budget on the direction with no detail in it.
 */
function resolveComponents(componentsX: number, componentsY: number): [number, number] {
	let cx = Math.max(1, Math.min(MAX_COMPONENTS, Math.round(componentsX) || 1));
	let cy = Math.max(1, Math.min(MAX_COMPONENTS, Math.round(componentsY) || 1));
	while (4 + 2 * cx * cy > MAX_HASH_LENGTH && (cx > 1 || cy > 1)) {
		if (cx >= cy) cx--;
		else cy--;
	}
	return [cx, cy];
}
// #endregion

// #region Encoder
/**
 * Encode an RGBA buffer as a BlurHash string.
 *
 * `rgba` is row-major, four bytes per pixel, exactly `width · height · 4` long — the shape
 * `CanvasRenderingContext2D.getImageData().data` returns. The alpha channel is ignored: BlurHash has
 * no way to express transparency, and a caller that composited the image onto a known ground has
 * already made that decision more honestly than this function could.
 *
 * Throws a {@link RangeError} on a buffer whose length disagrees with its stated dimensions. That is
 * the one condition where continuing would silently encode a different image than the caller asked
 * about, and a placeholder that is confidently wrong is worse than no placeholder — every caller in
 * this feature catches and records the absence instead.
 *
 * Cost is `O(width · height · cx · cy)` with the per-axis cosines precomputed, so the callers' 64px
 * sample bound is what keeps a 6000px photograph from costing anything noticeable.
 */
export function encodeBlurHash(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
	componentsX: number,
	componentsY: number,
): string {
	const w = Math.trunc(width);
	const h = Math.trunc(height);
	if (w < 1 || h < 1) {
		throw new RangeError("A BlurHash needs at least one pixel in each direction.");
	}
	if (rgba.length !== w * h * 4) {
		throw new RangeError(
			`Pixel buffer is ${rgba.length} bytes; ${w}x${h} needs ${w * h * 4}.`,
		);
	}
	const [cx, cy] = resolveComponents(componentsX, componentsY);

	// The basis is separable, so each axis's cosines are evaluated once and reused across the other.
	const cosX = new Float64Array(cx * w);
	for (let x = 0; x < cx; x++) {
		for (let i = 0; i < w; i++) cosX[x * w + i] = Math.cos((Math.PI * x * i) / w);
	}
	const cosY = new Float64Array(cy * h);
	for (let y = 0; y < cy; y++) {
		for (let j = 0; j < h; j++) cosY[y * h + j] = Math.cos((Math.PI * y * j) / h);
	}

	// Flat rather than an array of triples: one allocation instead of `cx · cy` of them, and the
	// index arithmetic is the same either way.
	const factors = new Float64Array(cx * cy * 3);
	for (let y = 0; y < cy; y++) {
		for (let x = 0; x < cx; x++) {
			// The DC term is the mean; every AC term is doubled because the basis covers half a period.
			const normalisation = x === 0 && y === 0 ? 1 : 2;
			let r = 0;
			let g = 0;
			let b = 0;
			for (let j = 0; j < h; j++) {
				const by = cosY[y * h + j];
				const row = j * w * 4;
				for (let i = 0; i < w; i++) {
					const basis = cosX[x * w + i] * by;
					const p = row + i * 4;
					r += basis * LINEAR[rgba[p]];
					g += basis * LINEAR[rgba[p + 1]];
					b += basis * LINEAR[rgba[p + 2]];
				}
			}
			const scale = normalisation / (w * h);
			const k = (y * cx + x) * 3;
			factors[k] = r * scale;
			factors[k + 1] = g * scale;
			factors[k + 2] = b * scale;
		}
	}

	const acCount = cx * cy - 1;
	let hash = encode83(cx - 1 + (cy - 1) * 9, 1);

	// Every AC coefficient is stored relative to the largest one, so the six bits spent on each are
	// spent across the range this particular image actually occupies.
	let maximumValue = 1;
	if (acCount > 0) {
		let actualMaximum = 0;
		for (let k = 3; k < factors.length; k++) {
			actualMaximum = Math.max(actualMaximum, Math.abs(factors[k]));
		}
		const quantised = Math.max(0, Math.min(82, Math.floor(actualMaximum * 166 - 0.5)));
		maximumValue = (quantised + 1) / 166;
		hash += encode83(quantised, 1);
	} else {
		hash += encode83(0, 1);
	}

	hash += encode83(encodeDC(factors[0], factors[1], factors[2]), 4);
	for (let k = 1; k <= acCount; k++) {
		const i = k * 3;
		hash += encode83(
			encodeAC(factors[i], factors[i + 1], factors[i + 2], maximumValue),
			2,
		);
	}
	return hash;
}

/** The average colour, packed as one 24-bit sRGB integer. */
function encodeDC(r: number, g: number, b: number): number {
	return (linearToSRGB(r) << 16) + (linearToSRGB(g) << 8) + linearToSRGB(b);
}

/**
 * One AC coefficient triple, packed into base-19 digits.
 *
 * The square root before quantising is what gives the small coefficients — where almost all of a
 * photograph's energy sits — most of the 19 levels, instead of spending them evenly across a range
 * whose top end is one bright corner.
 */
function encodeAC(r: number, g: number, b: number, maximumValue: number): number {
	const quantise = (value: number) =>
		Math.max(0, Math.min(18, Math.floor(signPow(value / maximumValue, 0.5) * 9 + 9.5)));
	return quantise(r) * 19 * 19 + quantise(g) * 19 + quantise(b);
}
// #endregion

// #region Component sizing
/**
 * Choose a component grid for an image of this shape.
 *
 * Roughly sixteen components spread by aspect ratio: a square gets 4x4, 16:9 gets 5x3, a panorama
 * spends its budget horizontally. More components buy detail nobody sees in a blurred placeholder
 * and cost two characters each in a column that has to hold the result.
 */
export function componentsFor(width: number, height: number): [number, number] {
	if (!(width > 0) || !(height > 0)) return [4, 4];
	const root = Math.sqrt(width / height);
	return resolveComponents(Math.round(4 * root), Math.round(4 / root));
}
// #endregion
