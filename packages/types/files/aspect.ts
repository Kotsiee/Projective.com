import { z } from "zod";
import type { AssetMetadata } from "./metadata.ts";

/**
 * files.aspect — the showcase aspect-ratio contract: the dimensions a picture was MEASURED at, the
 * band a product/showcase tile is allowed to occupy, and the one clamp every consumer applies.
 *
 * A masonry tile is sized from the picture's own ratio so columns interlock, and that is also the
 * mechanism by which one seller's 1:4 panorama or 1:3 tower runs away with a column. The band below is
 * the answer: a ratio inside it governs the tile exactly; a ratio outside it is clamped to the nearer
 * bound and the picture is cropped into the clamped box with `object-fit: cover`. The picture's own
 * ratio is never LOST — it travels alongside the clamped one, so an upload surface can say "this will
 * be cropped" before the seller publishes, and a preview can show the whole image.
 *
 * Lives beside `metadata.ts` rather than in the explore domain because the flag is raised at UPLOAD
 * (`media-facts.ts`, on the asset row's notes) long before a discovery item exists, and because the
 * profile's work masonry and the product masonry must clamp to the same band — two bands would let a
 * tile that fits on one surface overflow on the other.
 */

// #region Bounds
/**
 * The band a showcase tile may occupy, as `width / height`.
 *
 * `4:5` (0.8) is the tallest portrait a column can hold without one tile dominating it; `16:9` is the
 * widest landscape before a tile becomes a strip. Both are the RATIOS, stored as fractions so a test
 * can pin them against a literal rather than a float somebody rounded.
 */
export const SHOWCASE_ASPECT_MIN = 4 / 5;
export const SHOWCASE_ASPECT_MAX = 16 / 9;

/** The ratio a tile takes when nothing is known about its picture — the family's 4:3 landscape. */
export const SHOWCASE_ASPECT_DEFAULT = 4 / 3;
// #endregion

// #region Dimensions
/**
 * What a picture measured, as the flat triple the extractor already stores on
 * `files.items.metadata` (`width` · `height` · `aspectRatio`).
 *
 * Narrow enough to travel on a discovery item without dragging the whole metadata union along
 * (the `ImagePlaceholderSchema` precedent). `aspectRatio` is carried rather than re-derived because it
 * is what the extractor rounded to 4dp, and a consumer that divides for itself prints a different last
 * digit from the one the row stored.
 */
export const MediaDimensionsSchema = z.object({
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	/** `width / height`, rounded to 4dp. */
	aspectRatio: z.number().positive(),
});
export type MediaDimensions = z.infer<typeof MediaDimensionsSchema>;

/** `width / height`, to the 4dp the SSOT stores — one rounding, so SSR and a client re-read agree. */
export function aspectRatioOf(width: number, height: number): number {
	if (!(width > 0) || !(height > 0)) return SHOWCASE_ASPECT_DEFAULT;
	return Math.round((width / height) * 10_000) / 10_000;
}

/**
 * The measured dimensions an asset's metadata can offer a tile: an image's own size, or a video's
 * frame size. `undefined` for every other kind and for a row with no metadata — a tile is never given
 * a size nobody measured.
 */
export function mediaDimensionsOf(
	metadata: AssetMetadata | null | undefined,
): MediaDimensions | undefined {
	const media = metadata?.media;
	if (!media || (media.kind !== "image" && media.kind !== "video")) return undefined;
	return { width: media.width, height: media.height, aspectRatio: media.aspectRatio };
}
// #endregion

// #region The clamp
/** How the picture sits in its tile once the band has been applied. */
export type AspectFit = "natural" | "cover";

/** The tile's resolved ratio, and whether reaching it costs the picture a crop. */
export interface ShowcaseAspect {
	/** The ratio the TILE draws — always inside the band. */
	ratio: number;
	/** The ratio the PICTURE has. Equal to `ratio` when it needed no clamp. */
	natural: number;
	/** `natural` when the picture fits its tile whole; `cover` when the band cropped it. */
	fit: AspectFit;
}

/** Whether a ratio lies inside the showcase band (inclusive at both ends). */
export function withinShowcaseBounds(ratio: number): boolean {
	return Number.isFinite(ratio) && ratio >= SHOWCASE_ASPECT_MIN && ratio <= SHOWCASE_ASPECT_MAX;
}

/** A ratio pulled to the nearer bound of the band. A non-finite or non-positive input takes the default. */
export function clampShowcaseAspect(ratio: number): number {
	if (!Number.isFinite(ratio) || ratio <= 0) return SHOWCASE_ASPECT_DEFAULT;
	return Math.min(SHOWCASE_ASPECT_MAX, Math.max(SHOWCASE_ASPECT_MIN, ratio));
}

/**
 * Resolve the tile a picture gets. Accepts the measured dimensions, a bare ratio, or nothing — the
 * last takes the default ratio and reports it as `natural`, because nothing was cropped to reach it.
 */
export function showcaseAspectOf(
	source: MediaDimensions | number | null | undefined,
): ShowcaseAspect {
	const natural = typeof source === "number"
		? source
		: source
		? source.aspectRatio
		: SHOWCASE_ASPECT_DEFAULT;
	const safe = Number.isFinite(natural) && natural > 0 ? natural : SHOWCASE_ASPECT_DEFAULT;
	const ratio = clampShowcaseAspect(safe);
	return { ratio, natural: safe, fit: ratio === safe ? "natural" : "cover" };
}

/**
 * The sentence an upload records when a picture falls outside the band — `null` inside it.
 *
 * Written to `AssetMetadata.notes` beside the measurement rather than refusing the upload: a chat
 * attachment or a reference document is allowed to be any shape, and only a SHOWCASE surface cares.
 * The note is what lets that surface explain the crop it is about to apply without re-deciding the
 * rule. Bounded to the 200 characters the notes schema accepts.
 */
export function showcaseAspectNote(dims: MediaDimensions | null | undefined): string | null {
	if (!dims || withinShowcaseBounds(dims.aspectRatio)) return null;
	const side = dims.aspectRatio < SHOWCASE_ASPECT_MIN ? "taller" : "wider";
	return `Showcase aspect: ${dims.aspectRatio} is ${side} than the ${
		side === "taller" ? "4:5" : "16:9"
	} bound, so product tiles crop it to fit.`;
}
// #endregion
