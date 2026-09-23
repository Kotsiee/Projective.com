import {
	clampCrop,
	type ColorSummary,
	cropBox,
	type CropState,
	fitWithin,
	planTiers,
	RENDITION_ASPECT,
	RENDITION_MAX_EDGE,
	RENDITION_QUALITY,
	type RenditionPurpose,
	TIER_QUALITY,
	type VariantTier,
} from "@projective/types/files";
import { type Bitmap, decodeImage, encodeWebp, placeholderOf, renderCrop, resize } from "./image-codec.ts";

/**
 * image-jobs — the two things the media pipeline is ever asked to do with a still, as pure async
 * functions of their input bytes.
 *
 *  - **ingest** — a new LIBRARY upload has passed quarantine: decode it (which is itself the proof
 *    that it is the picture it claims to be), and write the three WebP tiers the picker and the hub
 *    browse with. The original bytes are kept exactly as uploaded.
 *  - **render** — cut a RENDITION for a public surface: clamp the editor's crop against the pixels
 *    actually decoded, cut it at native resolution (capped per purpose), and write that full object
 *    plus its tiers. Re-encoding is also the sanitiser: what reaches a public bucket is a fresh WebP
 *    the pipeline drew, carrying no EXIF (location, device) and nothing a polyglot could smuggle.
 *
 * Both return the placeholder facts (BlurHash + colour summary) computed from the smallest tier.
 * Run inside the Worker by `image-worker.ts`; importable directly by tests.
 */

// #region Types

export type ImageJob =
	| { kind: "ingest"; bytes: Uint8Array; mime: string }
	| {
		kind: "render";
		bytes: Uint8Array;
		mime: string;
		purpose: RenditionPurpose;
		crop: CropState;
	};

/** One encoded WebP object. */
export interface EncodedImage {
	bytes: Uint8Array;
	width: number;
	height: number;
}

export interface ImageJobResult {
	/** The decoded, upright source. */
	source: { width: number; height: number; animated: boolean; hasAlpha: boolean };
	/** A render's own object (the full crop); `null` for an ingest, which keeps its original bytes. */
	full: EncodedImage | null;
	tiers: Record<VariantTier, EncodedImage>;
	blurhash: string | null;
	colors: ColorSummary | null;
	/** The crop actually applied after clamping against the decoded picture (render only). */
	crop: CropState | null;
}

// #endregion

// #region Jobs

export async function runImageJob(job: ImageJob): Promise<ImageJobResult> {
	const decoded = await decodeImage(job.bytes, job.mime);
	const src = decoded.bitmap;
	const source = {
		width: src.width,
		height: src.height,
		animated: decoded.animated,
		hasAlpha: decoded.hasAlpha,
	};

	if (job.kind === "ingest") {
		const tiers = await encodeTiers(src, "library");
		const placeholder = placeholderOf(tiers.bitmaps.sm);
		return { source, full: null, tiers: tiers.encoded, ...placeholderFields(placeholder), crop: null };
	}

	const aspect = RENDITION_ASPECT[job.purpose];
	const image = { width: src.width, height: src.height };
	const crop = clampCrop(job.crop, image, aspect);
	const box = cropBox(crop, image, aspect);
	// Fit the box's native size under the purpose cap, then fix the height from the width so the
	// rendition's aspect is exact rather than off by a rounding pixel.
	const fitted = fitWithin(box.width, box.height, RENDITION_MAX_EDGE[job.purpose]);
	const width = fitted.width;
	const height = Math.max(1, Math.round(width / aspect));
	const cut = renderCrop(src, crop, aspect, width, height);
	const full: EncodedImage = { bytes: await encodeWebp(cut, RENDITION_QUALITY), width, height };
	const tiers = await encodeTiers(cut, job.purpose);
	const placeholder = placeholderOf(tiers.bitmaps.sm);
	return { source, full, tiers: tiers.encoded, ...placeholderFields(placeholder), crop };
}

/**
 * The three tiers of `src` for `purpose`, largest first so each smaller tier is resampled from the
 * one above it — the area filter makes that as good as resampling from the source, and far cheaper.
 */
async function encodeTiers(
	src: Bitmap,
	purpose: "library" | RenditionPurpose,
): Promise<{ encoded: Record<VariantTier, EncodedImage>; bitmaps: Record<VariantTier, Bitmap> }> {
	const plan = planTiers(purpose, src.width, src.height);
	const lg = resize(src, plan.lg.width, plan.lg.height);
	const md = resize(lg, plan.md.width, plan.md.height);
	const sm = resize(md, plan.sm.width, plan.sm.height);
	const bitmaps: Record<VariantTier, Bitmap> = { sm, md, lg };
	const [smBytes, mdBytes, lgBytes] = await Promise.all([
		encodeWebp(sm, TIER_QUALITY.sm),
		encodeWebp(md, TIER_QUALITY.md),
		encodeWebp(lg, TIER_QUALITY.lg),
	]);
	return {
		bitmaps,
		encoded: {
			sm: { bytes: smBytes, width: sm.width, height: sm.height },
			md: { bytes: mdBytes, width: md.width, height: md.height },
			lg: { bytes: lgBytes, width: lg.width, height: lg.height },
		},
	};
}

function placeholderFields(
	p: { blurhash: string | null; colors: ColorSummary | null },
): { blurhash: string | null; colors: ColorSummary | null } {
	return { blurhash: p.blurhash, colors: p.colors };
}

// #endregion
