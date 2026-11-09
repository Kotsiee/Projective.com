import {
	type AssetItem,
	CATEGORY_META,
	fileInspectHref,
	type InspectAsset,
	mediaProxyHref,
	shareHref,
} from "@projective/types/files";
import type { FileLinkPreview } from "@projective/types/links";

/**
 * file-cards — the card a file link earns in a message (Decision #401), mapped from the reader's own
 * read of the file: the inspector DTO for `/inspect/{uuid}`, the share resolution for `/share/{slug}`.
 * Pure, so the mapping is tested without a database. A file the reader cannot open never reaches
 * here, so it has no card and its link renders plainly.
 */

const NAME_MAX = 200;
const EXT_MAX = 12;
const SIZE_MAX = 16;

function clamp(value: string, max: number): string {
	return value.length <= max ? value : value.slice(0, max);
}

/** The card for an inspector link, from the DTO the inspector itself renders. */
export function fileCardFromInspect(url: string, asset: InspectAsset): FileLinkPreview {
	const picture = asset.viewer === "image" || asset.viewer === "svg";
	return {
		kind: "file",
		url,
		href: fileInspectHref(asset.id, { share: asset.share }),
		assetId: asset.id,
		name: clamp(asset.name || "File", NAME_MAX),
		ext: clamp(asset.ext, EXT_MAX),
		fileKind: asset.kind,
		typeLabel: asset.categoryLabel || null,
		sizeLabel: asset.sizeLabel ? clamp(asset.sizeLabel, SIZE_MAX) : null,
		thumbnail: picture ? mediaProxyHref(asset.id, { tier: "sm", share: asset.share }) : null,
	};
}

/** The card for a share link, from the asset the slug resolves to. */
export function fileCardFromShare(url: string, slug: string, asset: AssetItem): FileLinkPreview {
	const thumbnail = asset.kind === "image" && asset.thumbnailUrl?.startsWith("/")
		? asset.thumbnailUrl
		: null;
	return {
		kind: "file",
		url,
		href: shareHref(slug),
		assetId: null,
		name: clamp(asset.name || "File", NAME_MAX),
		ext: clamp(asset.ext, EXT_MAX),
		fileKind: asset.kind,
		typeLabel: CATEGORY_META[asset.category]?.label ?? null,
		sizeLabel: asset.sizeLabel ? clamp(asset.sizeLabel, SIZE_MAX) : null,
		thumbnail: thumbnail && thumbnail.length <= 600 ? thumbnail : null,
	};
}
