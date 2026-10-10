import {
	type AssetItem,
	CATEGORY_META,
	fileExtension,
	type InspectAccess,
	type InspectAsset,
	type InspectOwner,
	mediaProxyHref,
	resolveViewer,
	shareHref,
} from "@projective/types/files";
import { clamp } from "../../core/text.ts";

/**
 * inspect-dto — the pure projection behind the file inspector: one readable asset, as the page renders it.
 *
 * The base is the hub's own `AssetItem` (labels, `canManage`, category, extracted facts), so the inspector
 * and the grid agree about a file. Its `url`/`thumbnailUrl` are deliberately ignored — a public-bucket row
 * carries a raw storage URL there — and every address here is a same-origin proxy or page route instead.
 */

// #region Inputs

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a string is a `files.items` id; anything else is a 404 without a database round trip. */
export function isAssetId(id: string): boolean {
	return UUID.test(id);
}

/** Everything {@link toInspectAsset} needs beyond the projected row. */
export interface InspectSource {
	/** The row projected through `toAssetItem` for this viewer. */
	item: AssetItem;
	/** The name whose extension types the file (the display name, or the original when that has none). */
	fileName: string;
	/** `files.items.mime_type` as stored. */
	mimeType: string | null;
	access: InspectAccess;
	/** The share slug the viewer arrived with. */
	share: string | null;
	/** An `lg` WebP rendition was written for this asset. */
	renditionAvailable: boolean;
	owner: InspectOwner | null;
	/** The newest live item share link, when the viewer manages the asset. */
	shareSlug: string | null;
}

/** The owner's row in the public profile directory (`org.profiles_index`, which omits private profiles). */
export interface OwnerProfileRow {
	handle: string | null;
	name: string | null;
	avatar_file_id: string | null;
}

/** One `files.share_links` row, as the live-link pick reads it. */
export interface ShareLinkRow {
	slug: string;
	expires_at: string | null;
	download_limit: number | null;
	download_count: number | null;
	created_at: string;
}

// #endregion

// #region Pieces

/** How the viewer reached the file: a share slug, ownership, a signed-in read right, or a public read. */
export function inspectAccess(
	opts: { viaShare: boolean; viewerId: string; ownerUserId: string },
): InspectAccess {
	if (opts.viaShare) return "share";
	if (opts.viewerId.length === 0) return "public";
	return opts.viewerId === opts.ownerUserId ? "owner" : "member";
}

/**
 * The owner as any viewer may know them: their public directory entry, with the avatar as a proxy
 * address, never a storage URL. No entry (a private profile) is no owner.
 */
export function toInspectOwner(row: OwnerProfileRow | null): InspectOwner | null {
	if (!row) return null;
	const handle = clamp(row.handle, 40).trim() || null;
	const name = clamp(row.name, 120).replace(/\s+/g, " ").trim() || (handle ? `@${handle}` : "");
	if (!name) return null;
	return {
		handle,
		name,
		avatarSrc: row.avatar_file_id && isAssetId(row.avatar_file_id)
			? mediaProxyHref(row.avatar_file_id, { tier: "sm" })
			: null,
	};
}

/** The newest share link that would still resolve: not expired and under its download limit. */
export function liveShareSlug(rows: readonly ShareLinkRow[], nowMs: number): string | null {
	const live = rows.filter((row) =>
		(row.expires_at === null || Date.parse(row.expires_at) > nowMs) &&
		(row.download_limit === null || (row.download_count ?? 0) < row.download_limit)
	);
	live.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
	return live[0]?.slug ?? null;
}

/** The extension a name actually carries — `""` for a bare name like `Dockerfile` or `Brand logo`. */
export function extensionOf(name: string): string {
	const base = (name.split(/[\\/]/).pop() ?? name).trim();
	return base.lastIndexOf(".") > 0 ? clamp(fileExtension(base), 12) : "";
}

function positiveInt(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// #endregion

// #region Projection

/** Project one readable asset into the inspector's DTO (`InspectAssetSchema`). */
export function toInspectAsset(source: InspectSource): InspectAsset {
	const { item, share } = source;
	const mimeType = (source.mimeType ?? "").trim() || "application/octet-stream";
	const choice = resolveViewer(source.fileName, mimeType);
	const media = item.metadata?.media ?? null;
	const rendition = source.renditionAvailable
		? mediaProxyHref(item.id, { tier: "lg", share })
		: null;

	let viewer = choice.viewer;
	let src = mediaProxyHref(item.id, { share });
	if (choice.rendition) {
		if (rendition) src = rendition;
		else viewer = "unsupported";
	}

	const durationMs = media?.kind === "video" || media?.kind === "audio" ? media.durationMs : null;
	const peaks = media?.kind === "audio" && media.peaks.length > 0 ? media.peaks : null;
	const pageCount = media?.kind === "document" ? positiveInt(media.pageCount) : null;
	const blurhash = media?.kind === "image" || media?.kind === "video" || media?.kind === "document"
		? media.blurhash
		: null;

	return {
		id: item.id,
		name: item.name,
		ext: extensionOf(source.fileName),
		mimeType,
		category: item.category,
		categoryLabel: CATEGORY_META[item.category].label,
		kind: item.kind,
		viewer,
		language: choice.language,
		modelFormat: choice.modelFormat,
		delimiter: choice.delimiter,
		sizeBytes: item.sizeBytes,
		sizeLabel: item.sizeLabel,
		width: positiveInt(item.width),
		height: positiveInt(item.height),
		durationMs,
		durationLabel: item.durationLabel,
		pageCount,
		peaks,
		blurhash,
		createdAt: item.createdAt,
		dateLabel: item.dateLabel,
		owner: source.owner,
		ownerType: item.ownerType,
		visibility: item.visibility,
		access: source.access,
		canManage: item.canManage,
		src,
		previewSrc: rendition,
		downloadHref: mediaProxyHref(item.id, { download: true, share }),
		share,
		shareUrl: item.canManage && source.shareSlug ? shareHref(source.shareSlug) : null,
		downloadCount: item.canManage ? item.downloadCount : null,
		contentHash: item.contentHash,
	};
}

// #endregion
