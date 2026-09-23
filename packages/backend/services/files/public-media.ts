import type { SupabaseClient } from "supabaseClient";
import {
	type ImagePlaceholder,
	isVideoRef,
	type MediaRef,
	MediaRefSchema,
	refFor,
	VARIANT_TIERS,
	type VariantTier,
} from "@projective/types/files";
import { publicObjectUrl } from "../../core/storage-url.ts";

/**
 * public-media — how a PUBLIC stored image becomes the URL, `srcset` and placeholder a surface
 * paints.
 *
 * The database answers with storage REFS (`files.fn_public_media_ref`: a bucket, a path, the WebP
 * tiers beside it, a BlurHash); this module is the one place those turn into URLs, through the one
 * URL builder (`core/storage-url.ts`). Every reader that shows somebody's picture — the profile, a
 * project roster, a message sender, the nav's account button — goes through here, which is what
 * makes an avatar change reach all of them on their next read instead of living in a dozen copies.
 */

// #region Parsing

/** One projection from the database, parsed defensively: `null` on anything malformed or absent. */
export function parseMediaRef(raw: unknown): MediaRef | null {
	if (!raw || typeof raw !== "object") return null;
	const parsed = MediaRefSchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

// #endregion

// #region URLs

/**
 * The URL of a reference at a tier — that tier, else the nearest larger one, else the original (a
 * seeded asset carries no tiers). `null` tier asks for the original object itself; for a video that
 * is the video, and any tier is its poster still.
 */
export function mediaUrl(ref: MediaRef | null | undefined, tier: VariantTier | null): string | null {
	if (!ref) return null;
	const at = refFor(ref, tier);
	return publicObjectUrl(at.bucket, at.path);
}

/**
 * A `srcset` across the tiers that exist (width descriptors), or `undefined` when the reference has
 * no tiers to offer a choice between. For a video the tiers are poster stills, so this is the
 * poster's srcset.
 */
export function mediaSrcset(ref: MediaRef | null | undefined): string | undefined {
	if (!ref) return undefined;
	const parts: string[] = [];
	for (const tier of VARIANT_TIERS) {
		const v = ref.variants?.[tier];
		if (!v) continue;
		const url = publicObjectUrl(v.bucket, v.path);
		if (url) parts.push(`${url} ${v.width}w`);
	}
	return parts.length > 1 ? parts.join(", ") : undefined;
}

/** What a surface may paint before the picture arrives — undefined when nothing is known. */
export function mediaPlaceholder(ref: MediaRef | null | undefined): ImagePlaceholder | undefined {
	if (!ref || (!ref.blurhash && !ref.color)) return undefined;
	return { blurhash: ref.blurhash ?? null, color: ref.color ?? null };
}

/** Whether a reference is a video. */
export function isVideoMedia(ref: MediaRef | null | undefined): boolean {
	return !!ref && isVideoRef(ref);
}

/** The intrinsic aspect ratio of a reference, when its size is known. */
export function mediaAspect(ref: MediaRef | null | undefined): number | null {
	if (!ref?.width || !ref.height) return null;
	return ref.width / ref.height;
}

// #endregion

// #region Batch resolution

/**
 * Resolve many file ids to their public references in ONE round trip (`files.get_public_media`),
 * through whichever client the caller holds — a user's or the anonymous one; the function returns
 * nothing that is not already world-readable. Ids with no public media are simply absent from the
 * map. Never throws: a failed lookup costs pictures, not the page.
 */
export async function fetchPublicMedia(
	client: SupabaseClient,
	ids: readonly (string | null | undefined)[],
): Promise<Map<string, MediaRef>> {
	const out = new Map<string, MediaRef>();
	const unique = [...new Set(ids.filter((id): id is string => !!id))];
	if (unique.length === 0) return out;
	try {
		const { data, error } = await client.schema("files").rpc("get_public_media", { p_ids: unique });
		if (error || !Array.isArray(data)) return out;
		for (const row of data as Array<{ id: string; ref: unknown }>) {
			const ref = parseMediaRef(row.ref);
			if (ref) out.set(row.id, ref);
		}
	} catch { /* pictures are not worth failing a read for */ }
	return out;
}

// #endregion
