import {
	type AssetItem,
	type AssetMetadata,
	type FileObjectTier,
	type ImagePlaceholder,
	imagePlaceholderOf,
	inspectable,
	mediaProxyHref,
	TIER_LONG_EDGE,
	VARIANT_TIERS,
} from "@projective/types/files";

/**
 * asset-media — the one decision of which address draws an asset's picture.
 *
 * A stored, uploaded file is read through the same-origin media proxy, so no storage host, bucket or
 * object path reaches the page; a fixture, a link or a connector file keeps the address its producer
 * gave it. Pure and DOM-free, so SSR and a client refetch resolve the same address.
 */

// #region Types

/** A proxy rendition tier, or the original bytes. */
export type AssetMediaTier = FileObjectTier | "original";

/**
 * The slice of an asset the resolver reads. `assetId` is the `files.items` id when it differs from
 * the row id (a message attachment's link id); `ext` lets the srcset skip vector images.
 */
export type AssetMediaRef =
	& Pick<AssetItem, "id" | "source" | "status" | "url" | "thumbnailUrl" | "kind">
	& { assetId?: string | null; ext?: string };

/** The placeholder `ProgressiveImage` paints beneath a picture while it loads. */
export type ProgressiveImagePlaceholder = ImagePlaceholder;

// #endregion

// #region Internals

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VECTOR_EXTENSIONS: ReadonlySet<string> = new Set(["svg", "svgz"]);

function storedId(asset: AssetMediaRef): string | null {
	if (!inspectable(asset)) return null;
	const candidate = asset.assetId ?? asset.id;
	return UUID.test(candidate) ? candidate : null;
}

function ownHref(href: string | null | undefined): string | null {
	const value = href?.trim() ?? "";
	return value === "" || value === "#" ? null : value;
}

function shareParam(href: string | null | undefined): string | null {
	if (!href || !href.startsWith("/")) return null;
	const query = href.indexOf("?");
	if (query < 0) return null;
	return new URLSearchParams(href.slice(query + 1)).get("share") || null;
}

function scopeOf(asset: AssetMediaRef, share: string | null | undefined): string | null {
	if (share !== undefined) return share || null;
	return shareParam(asset.url) ?? shareParam(asset.thumbnailUrl);
}

// #endregion

// #region Resolvers

/**
 * Proxy address for an asset's bytes, or its own URL when it has no stored bytes; null when nothing
 * renderable.
 *
 * A rendition tier goes through the proxy only for an image (a video has no WebP tier, and its
 * poster lives in `thumbnailUrl`). `share` left undefined inherits the slug from the asset's own
 * same-origin address, so a shared-folder row keeps its anonymous read; `null` means none.
 */
export function assetMediaSrc(
	asset: AssetMediaRef,
	tier: AssetMediaTier = "original",
	share?: string | null,
): string | null {
	const id = storedId(asset);
	const scope = id ? scopeOf(asset, share) : null;
	if (tier === "original") return id ? mediaProxyHref(id, { share: scope }) : ownHref(asset.url);
	if (id && asset.kind === "image") return mediaProxyHref(id, { tier, share: scope });
	const thumbnail = ownHref(asset.thumbnailUrl);
	if (thumbnail || asset.kind !== "image" || asset.source === "link") return thumbnail;
	return ownHref(asset.url);
}

/**
 * Width-described proxy candidates (`sm 320w, md 1280w, lg 2560w`) for a raster image with stored
 * bytes; null for anything else.
 */
export function assetMediaSrcset(asset: AssetMediaRef, share?: string | null): string | null {
	const id = storedId(asset);
	if (!id || asset.kind !== "image") return null;
	if (asset.ext !== undefined && VECTOR_EXTENSIONS.has(asset.ext.toLowerCase())) return null;
	const scope = scopeOf(asset, share);
	return VARIANT_TIERS
		.map((tier) => `${mediaProxyHref(id, { tier, share: scope })} ${TIER_LONG_EDGE.library[tier]}w`)
		.join(", ");
}

/** The BlurHash and average tone an asset's metadata offers its thumbnail, if any. */
export function assetPlaceholder(
	asset: { metadata?: AssetMetadata | null },
): ProgressiveImagePlaceholder | undefined {
	return imagePlaceholderOf(asset.metadata);
}

// #endregion
