import type { ColorSummary } from "../../types/file-types.ts";

/**
 * colors — the average and the dominant colours of a sampled bitmap.
 *
 * ## The weighting rule, which is the whole module
 *
 * Pixels are pooled into quantised buckets and each bucket is weighted, so a small vivid region can
 * outvote a large flat one. The weight is **absolute chroma (`max - min`) biased toward mid-tones**,
 * never the relative saturation `(max - min) / max` that most colour-thief implementations reach for.
 *
 * Relative saturation is the trap, and this repo has already shipped it once and fixed it (Decision
 * #74): `rgb(0, 10, 20)` scores a perfect 1.0 while being indistinguishable from black, so shadow
 * detail with a faint cast wins every vote. Measured against the discovery corpus, relative
 * saturation returned near-black for 7 of the first 8 thumbnails. `colors_test.ts` pins the failure
 * case directly rather than only the happy path, because a wrong dominant colour still renders
 * perfectly — it just quietly describes a different image.
 *
 * ## These are facts, not a tint
 *
 * `AmbientPalette.island.tsx` clamps its extracted swatch into a usable lightness band, because it is
 * producing a hover wash that has to read against a surface. This module is producing a stored
 * DESCRIPTION of an asset, so it reports what is there — a genuinely dark photograph has dark
 * dominant colours, and a consumer that needs a legible tint is the one holding the context to
 * decide how far to lift it.
 */

// #region Tuning
/**
 * Bits dropped per channel before pooling. Three leaves 32 levels per channel, which is coarse enough
 * that a smooth gradient lands in a handful of buckets instead of thousands of singletons.
 */
const QUANTISE_BITS = 3;

/**
 * Pixels at the very ends of the range are skipped when VOTING.
 *
 * Near-black and blown-out white carry no usable hue and dominate photographs by area, so including
 * them means the answer for most images is "black" or "white" — true of the histogram, useless as a
 * description. They still count toward the flat average, which is the figure that is supposed to
 * include them.
 */
const VOTE_MIN_MAX = 40;
const VOTE_MAX_MIN = 226;

/** Alpha below this is treated as absent — a transparent pixel has no colour to report. */
const OPAQUE_ENOUGH = 128;

/**
 * How far apart two reported dominants must be, summed across channels.
 *
 * Without it, a sky gradient returns three shades of one blue and calls them three dominant colours.
 * The bound is generous relative to the quantisation step so neighbouring buckets of one region
 * collapse to their strongest member.
 */
const MIN_SEPARATION = 60;
// #endregion

// #region Bucket
/** One quantised colour bucket: accumulated vote weight plus the true channel sums of its members. */
interface Bucket {
	weight: number;
	r: number;
	g: number;
	b: number;
	count: number;
}

/**
 * The vote one pixel casts.
 *
 * `midness` peaks at mid-lightness and falls off toward both ends, floored so a dark-but-genuinely
 * colourful region still competes instead of being excluded outright. The constant term keeps a flat
 * monochrome image from scoring zero everywhere, which would leave no bucket to pick at all.
 */
function voteWeight(max: number, min: number): number {
	const chroma = (max - min) / 255;
	const luminance = (max + min) / 510;
	const midness = Math.max(0.15, 1 - Math.abs(luminance - 0.5) * 1.6);
	return 0.02 + chroma * midness;
}
// #endregion

// #region Formatting
/** `#rrggbb`, lower-case — the one spelling `HexColorSchema` accepts. */
function toHex(r: number, g: number, b: number): string {
	const channel = (value: number) =>
		Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Manhattan channel distance — cheap, and enough to tell two dominants apart. */
function separation(a: Bucket, b: Bucket): number {
	return Math.abs(a.r / a.count - b.r / b.count) +
		Math.abs(a.g / a.count - b.g / b.count) +
		Math.abs(a.b / a.count - b.b / b.count);
}
// #endregion

// #region Public
/**
 * The flat average of every sufficiently opaque pixel, as `#rrggbb`.
 *
 * Returns `null` when nothing was opaque enough to average — a fully transparent bitmap has no
 * average colour, and `#000000` is a value a reader would believe.
 */
export function averageColor(rgba: Uint8ClampedArray): string | null {
	let r = 0;
	let g = 0;
	let b = 0;
	let seen = 0;
	for (let i = 0; i + 3 < rgba.length; i += 4) {
		if (rgba[i + 3] < OPAQUE_ENOUGH) continue;
		r += rgba[i];
		g += rgba[i + 1];
		b += rgba[i + 2];
		seen++;
	}
	if (seen === 0) return null;
	return toHex(r / seen, g / seen, b / seen);
}

/**
 * Up to `count` dominant colours, most prominent first.
 *
 * An image whose every pixel is an extreme — a pure black frame, a blown-out scan — has no bucket to
 * report and falls through to its own flat average, which is the honest answer for something that
 * genuinely has no dominant hue. A fully transparent bitmap returns nothing at all.
 */
export function dominantColors(rgba: Uint8ClampedArray, count: number): string[] {
	const wanted = Math.max(0, Math.trunc(count));
	if (wanted === 0) return [];

	const buckets = new Map<number, Bucket>();
	for (let i = 0; i + 3 < rgba.length; i += 4) {
		if (rgba[i + 3] < OPAQUE_ENOUGH) continue;
		const r = rgba[i];
		const g = rgba[i + 1];
		const b = rgba[i + 2];
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		if (max < VOTE_MIN_MAX || min > VOTE_MAX_MIN) continue;

		const key = ((r >> QUANTISE_BITS) << 10) | ((g >> QUANTISE_BITS) << 5) | (b >> QUANTISE_BITS);
		const cell = buckets.get(key);
		if (cell) {
			cell.weight += voteWeight(max, min);
			cell.r += r;
			cell.g += g;
			cell.b += b;
			cell.count++;
		} else {
			buckets.set(key, { weight: voteWeight(max, min), r, g, b, count: 1 });
		}
	}

	if (buckets.size === 0) {
		const average = averageColor(rgba);
		return average ? [average] : [];
	}

	const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
	const chosen: Bucket[] = [];
	for (const cell of ranked) {
		if (chosen.length >= wanted) break;
		if (chosen.some((held) => separation(held, cell) < MIN_SEPARATION)) continue;
		chosen.push(cell);
	}
	return chosen.map((cell) => toHex(cell.r / cell.count, cell.g / cell.count, cell.b / cell.count));
}

/** How many dominants a {@link ColorSummary} may hold — `ColorSummarySchema` caps the array at three. */
const DOMINANT_MAX = 3;

/**
 * The colour summary an image or a video poster stores.
 *
 * `null` when the bitmap held nothing opaque to describe, so the metadata row says "no colours were
 * read" rather than reporting a fabricated black.
 */
export function colorSummary(rgba: Uint8ClampedArray): ColorSummary | null {
	const average = averageColor(rgba);
	if (average === null) return null;
	return { average, dominant: dominantColors(rgba, DOMINANT_MAX) };
}
// #endregion
