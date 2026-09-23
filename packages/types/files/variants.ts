import { z } from "zod";

/**
 * files.variants — the Zod SSOT for what the media pipeline DERIVES from an upload: the purpose an
 * asset serves, the WebP tiers written beside it, and the pixel plan behind each tier.
 *
 * Every image that reaches the platform goes through one server-side pipeline (quarantine → sniff →
 * decode → re-encode): the original is kept, and three WebP tiers are written beside it so no
 * surface ever downloads a 12-megapixel original to draw a 40px avatar. A PUBLIC surface (the
 * profile photo, a showcase slot) never shows a library asset directly — it shows a RENDITION: a
 * cropped, re-encoded copy cut from the library asset into a public bucket, with its own tiers.
 *
 * {@link AssetPurpose} and {@link VariantTier} mirror `files.asset_purpose` / `files.variant_tier`
 * member-for-member (00000004); the tier plan below is the one both the pipeline and every reader
 * work from, so "which tier is a card thumbnail" is decided once.
 */

// #region Vocabulary

/**
 * What an asset is FOR. `library` is an upload a person can pick again; `avatar` and `showcase` are
 * renditions the pipeline cut for one public surface. Mirrors `files.asset_purpose`.
 */
export const AssetPurpose = z.enum(["library", "avatar", "showcase"]);
export type AssetPurpose = z.infer<typeof AssetPurpose>;

/** The purposes that are renditions — everything but a library upload. */
export const RenditionPurpose = z.enum(["avatar", "showcase"]);
export type RenditionPurpose = z.infer<typeof RenditionPurpose>;

/** The derived WebP tiers, smallest first. Mirrors `files.variant_tier`. */
export const VariantTier = z.enum(["sm", "md", "lg"]);
export type VariantTier = z.infer<typeof VariantTier>;

/** Every tier, smallest first — the order a `srcset` is written in. */
export const VARIANT_TIERS: readonly VariantTier[] = VariantTier.options;

// #endregion

// #region The tier plan

/**
 * The longest edge each tier is fit into, per purpose, in pixels. A tier is never an upscale: a
 * source smaller than a target is written at its own size (see {@link fitWithin}), so every
 * processed image carries all three tiers and a reader never needs a "tier missing" branch.
 *
 * - `library` — the picker's thumbnail grid (`sm`), a preview pane (`md`), a full-screen view (`lg`).
 * - `avatar` — chrome at 24–48px @2x (`sm`), the 72–128px hero disc @2x (`md`), the full-size
 *   expansion modal (`lg`). Avatars are square, so the edge is both sides.
 * - `showcase` — a card thumbnail (`sm`), the hero frame at 1x–2x (`md`/`lg`).
 */
export const TIER_LONG_EDGE: Readonly<Record<AssetPurpose, Readonly<Record<VariantTier, number>>>> = {
	library: { sm: 320, md: 1280, lg: 2560 },
	avatar: { sm: 96, md: 256, lg: 1024 },
	showcase: { sm: 480, md: 1280, lg: 2400 },
};

/**
 * The longest edge of a rendition's own stored object (the "full" crop) — the largest picture the
 * platform will ever serve for that surface. A crop beyond it is scaled down; a smaller one keeps
 * its native size.
 */
export const RENDITION_MAX_EDGE: Readonly<Record<RenditionPurpose, number>> = {
	avatar: 2048,
	showcase: 3200,
};

/** WebP quality (0–100) per tier. Lower for the thumbnails, where the bytes matter most. */
export const TIER_QUALITY: Readonly<Record<VariantTier, number>> = { sm: 76, md: 80, lg: 82 };

/** The quality a rendition's full object is encoded at — a notch above the largest tier. */
export const RENDITION_QUALITY = 88;

/**
 * The output aspect ratio (width ÷ height) a rendition is cropped to. The avatar is stored square
 * (and shown as a circle); the showcase frame is 16:10.
 */
export const RENDITION_ASPECT: Readonly<Record<RenditionPurpose, number>> = {
	avatar: 1,
	showcase: 16 / 10,
};

/**
 * `width × height` scaled so the longer edge is at most `longEdge`, never enlarged, and never below
 * one pixel. Rounded to whole pixels. Total.
 */
export function fitWithin(
	width: number,
	height: number,
	longEdge: number,
): { width: number; height: number } {
	const w = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
	const h = Math.max(1, Math.round(Number.isFinite(height) ? height : 1));
	const cap = Math.max(1, Math.round(longEdge));
	const long = Math.max(w, h);
	if (long <= cap) return { width: w, height: h };
	const scale = cap / long;
	return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The pixel size of every tier for a source of `width × height` serving `purpose`. */
export function planTiers(
	purpose: AssetPurpose,
	width: number,
	height: number,
): Record<VariantTier, { width: number; height: number }> {
	const edges = TIER_LONG_EDGE[purpose];
	return {
		sm: fitWithin(width, height, edges.sm),
		md: fitWithin(width, height, edges.md),
		lg: fitWithin(width, height, edges.lg),
	};
}

// #endregion

// #region Object paths

/**
 * The object path of a tier, written beside its parent object: `…/{assetId}/{tier}.webp`. One
 * builder so the pipeline that writes a tier and anything that ever has to find one agree.
 */
export function variantObjectPath(parentPath: string, tier: VariantTier): string {
	const cut = parentPath.lastIndexOf("/");
	const dir = cut >= 0 ? parentPath.slice(0, cut) : "";
	return dir ? `${dir}/${tier}.webp` : `${tier}.webp`;
}

// #endregion

// #region The stored-object reference (the SQL projection)

/** One tier as `files.fn_public_media_ref` projects it. */
export const VariantRefSchema = z.object({
	bucket: z.string(),
	path: z.string(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	mime: z.string().optional(),
});
export type VariantRef = z.infer<typeof VariantRefSchema>;

/**
 * A public stored image (or video) as `files.fn_public_media_ref` projects it — storage REFS, never a
 * URL; the URL is a deployment fact built in `packages/backend/core/storage-url.ts`. Snake_case
 * because it is the database's own document, parsed at the service boundary.
 */
export const MediaRefSchema = z.object({
	id: z.string(),
	bucket: z.string(),
	path: z.string(),
	mime: z.string(),
	purpose: AssetPurpose.nullable().optional(),
	width: z.number().int().positive().nullable().optional(),
	height: z.number().int().positive().nullable().optional(),
	duration_ms: z.number().int().min(0).nullable().optional(),
	blurhash: z.string().nullable().optional(),
	color: z.string().nullable().optional(),
	variants: z.object({
		sm: VariantRefSchema.optional(),
		md: VariantRefSchema.optional(),
		lg: VariantRefSchema.optional(),
	}).partial().default({}),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

/** Whether a reference is a video (its variants are then poster stills). */
export function isVideoRef(ref: Pick<MediaRef, "mime">): boolean {
	return ref.mime.startsWith("video/");
}

/**
 * The best stored object for a tier: that tier when the pipeline wrote it, otherwise the nearest
 * LARGER tier, otherwise the original — a seeded asset that predates the pipeline carries no tiers
 * and is drawn from its original, which is correct if heavier. For a video the tiers are poster
 * stills, so asking a video for a tier yields its poster and asking for `null` yields the video.
 */
export function refFor(
	ref: MediaRef,
	tier: VariantTier | null,
): { bucket: string; path: string; width: number | null; height: number | null } {
	if (tier) {
		const order = VARIANT_TIERS.slice(VARIANT_TIERS.indexOf(tier));
		for (const t of order) {
			const v = ref.variants?.[t];
			if (v) return { bucket: v.bucket, path: v.path, width: v.width, height: v.height };
		}
	}
	return { bucket: ref.bucket, path: ref.path, width: ref.width ?? null, height: ref.height ?? null };
}

// #endregion
