import {
	type AssetFolder,
	type AssetItem,
	type AssetMetadata,
	AssetMetadataSchema,
	type AssetOwnerType,
	type AssetSource,
	type AssetVisibility,
	categoryToKind,
	describeFile,
	type FileCategory,
	type FileKind,
	fileObjectHref,
	type FileStatus,
	type LinkAttachment,
	type LinkScanStatus,
} from "@projective/types/files";
import { clamp, clampOr } from "../../core/text.ts";
import { isPublicBucket, publicObjectUrl } from "../../core/storage-url.ts";
import { applyMediaFacts } from "./media-facts.ts";

/**
 * asset-row — the ONE projection from a `files.items` row onto the `AssetItem` every grid cell, table
 * row, preview pane and picker tile renders, plus the folder twin.
 *
 * Every surface that reads the asset registry — the `/files` hub, a project channel's Files tab, a
 * conversation's files, a share link — draws the same row, so they project it through the same code.
 * Two projections of one table is how a file comes to be "2.4 MB" in one place and "2.3 MB" in the
 * next, or public in the hub and private in the channel beside it.
 *
 * Pure except for the storage base URL; every read issues its own queries and hands rows here.
 */

// #region Columns + row shapes

/** The `files.items` columns every projection selects. */
export const ITEM_COLUMNS = [
	"id",
	"owner_user_id",
	"owner_type",
	"owner_entity_id",
	"folder_id",
	"bucket_id",
	"storage_path",
	"display_name",
	"original_name",
	"mime_type",
	"size_bytes",
	"category",
	"metadata",
	"status",
	"source",
	"visibility",
	"purpose",
	"starred",
	"content_hash",
	"hash_sampled",
	"download_count",
	"external_web_url",
	"link_url",
	"link_domain",
	"link_title",
	"link_description",
	"link_favicon_url",
	"link_scan_status",
	"link_scanned_at",
	"created_at",
].join(", ");

/** One `files.items` row as selected by {@link ITEM_COLUMNS}. */
export interface ItemRow {
	id: string;
	owner_user_id: string;
	owner_type: string | null;
	owner_entity_id: string | null;
	folder_id: string | null;
	bucket_id: string;
	storage_path: string;
	display_name: string | null;
	original_name: string | null;
	mime_type: string | null;
	/** `bigint` — some PostgREST/driver combinations hand a bigint back as a decimal string. */
	size_bytes: number | string | null;
	category: string | null;
	metadata: unknown;
	status: string | null;
	source: string | null;
	visibility: string | null;
	purpose: string | null;
	starred: boolean | null;
	content_hash: string | null;
	hash_sampled: boolean | null;
	download_count: number | null;
	external_web_url: string | null;
	link_url: string | null;
	link_domain: string | null;
	link_title: string | null;
	link_description: string | null;
	link_favicon_url: string | null;
	link_scan_status: string | null;
	link_scanned_at: string | null;
	created_at: string;
}

/** The `files.folders` columns every folder read selects. */
export const FOLDER_COLUMNS =
	"id, name, parent_folder_id, path, owner_type, owner_user_id, owner_entity_id, source, external_folder_id, visibility, created_at, updated_at";

/** One `files.folders` row as selected by {@link FOLDER_COLUMNS}. */
export interface FolderRow {
	id: string;
	name: string | null;
	parent_folder_id: string | null;
	path: string[] | null;
	owner_type: string | null;
	owner_user_id: string;
	owner_entity_id: string | null;
	source: string | null;
	external_folder_id: string | null;
	visibility: string | null;
	created_at: string;
	updated_at: string;
}

// #endregion

// #region Labels

/*
 * Every pre-formatted label is derived from UTC components, never from local time or `Intl`: the
 * server renders them once and the island re-renders them on its own refetch, and a timezone between
 * the two would visibly rewrite the list after hydration.
 */

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** `h:mm AM/PM` from an epoch instant, in UTC. */
export function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * `Today` / `Yesterday` / `Mon, Jul 14`, relative to `now` — a parameter so every row on one page is
 * dated against ONE instant, and a page straddling midnight cannot show two meanings of "Today".
 */
export function fmtDay(ms: number, now: number): string {
	const diff = Math.floor(now / DAY_MS) - Math.floor(ms / DAY_MS);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `Jul 14 · 2:30 PM` — the grid hover reveal and the list's date column. */
export function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}

/** Human byte size ("2.4 MB"). */
export function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

/** A `bigint` column as a safe, non-negative integer. */
export function bytesOf(raw: number | string | null | undefined): number {
	const n = typeof raw === "string" ? Number(raw) : raw;
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// #endregion

// #region Enum coercion

/*
 * The `files.*` enums mirror their Zod counterparts member-for-member, so these are guards against a
 * FUTURE member reaching a client as an unparseable row, not translations. Each fallback is chosen so
 * being wrong is quiet rather than misleading.
 */

const ASSET_SOURCES: ReadonlySet<string> = new Set([
	"supabase",
	"google_drive",
	"dropbox",
	"frameio",
	"s3",
	"link",
]);

/** Unknown → `supabase`: an asset we cannot place is one of ours until something says otherwise. */
export function toAssetSource(raw: string | null | undefined): AssetSource {
	return (raw && ASSET_SOURCES.has(raw) ? raw : "supabase") as AssetSource;
}

const FILE_STATUSES: ReadonlySet<string> = new Set([
	"pending_upload",
	"scanning",
	"uploaded",
	"error",
	"quarantined",
]);

/** Unknown → `uploaded`, unless the caller knows better (a registry read of in-flight rows does). */
export function toFileStatus(raw: string | null | undefined, fallback: FileStatus = "uploaded"): FileStatus {
	return (raw && FILE_STATUSES.has(raw) ? raw : fallback) as FileStatus;
}

const VISIBILITIES: ReadonlySet<string> = new Set(["private", "link", "public"]);

/** Unknown → `private`, the narrowest reading. A privacy scope must never widen by accident. */
export function toAssetVisibility(raw: string | null | undefined): AssetVisibility {
	return (raw && VISIBILITIES.has(raw) ? raw : "private") as AssetVisibility;
}

const OWNER_KINDS: ReadonlySet<string> = new Set(["user", "team", "business", "organisation"]);

/** Unknown → `user`, matching the column's own default. */
export function toAssetOwnerType(raw: string | null | undefined): AssetOwnerType {
	return (raw && OWNER_KINDS.has(raw) ? raw : "user") as AssetOwnerType;
}

const SCAN_STATUSES: ReadonlySet<string> = new Set([
	"pending",
	"safe",
	"suspicious",
	"blocked",
	"unscannable",
]);

/**
 * `link_scan_status` → `LinkScanStatus`. NULL ("never queued") has no member of its own and lands on
 * `pending` — the one value that neither vouches for the link nor accuses it.
 */
export function toLinkScanStatus(raw: string | null | undefined): LinkScanStatus {
	return (raw && SCAN_STATUSES.has(raw) ? raw : "pending") as LinkScanStatus;
}

const CATEGORIES: ReadonlySet<string> = new Set([
	"Document",
	"Presentation",
	"Spreadsheet",
	"Audio",
	"Video",
	"Image",
	"Vector",
	"Medical",
	"Scientific",
	"Compression",
	"Executable",
	"Code",
	"3D",
	"Database",
	"Data",
	"Font",
	"Security",
	"System",
	"Email",
	"DiskImage",
	"VMImage",
	"ContainerImage",
	"CAD",
	"GIS",
	"Ebook",
	"Config",
	"Package",
	"Other",
]);

/**
 * The rich category, the coarse {@link FileKind} that must agree with it, and the extension.
 *
 * The stored `category` wins unless it is the column's `'Other'` default, which is indistinguishable
 * from "never classified" — then the same classifier the writer uses runs here, so `kind` and
 * `category` provably agree. A link has no bytes to classify: its kind is `link` and its extension
 * empty.
 */
export function classify(row: Pick<ItemRow, "category" | "mime_type" | "source">, rawName: string): {
	category: FileCategory;
	kind: FileKind;
	ext: string;
} {
	const described = describeFile(rawName, row.mime_type ?? undefined);
	const stored = row.category;
	const category = (stored && stored !== "Other" && CATEGORIES.has(stored))
		? stored as FileCategory
		: described.category;
	const isLink = row.source === "link";
	return {
		category,
		kind: isLink ? "link" : categoryToKind(category),
		ext: isLink ? "" : clamp(described.extension, 12),
	};
}

// #endregion

// #region Facets

/**
 * The `link` facet for a `source = 'link'` asset. `null` without a URL — `items_link_url_check` makes
 * that unrepresentable for a real link, so this guards a row that is not one.
 */
export function toLinkAttachment(row: ItemRow): LinkAttachment | null {
	if (row.source !== "link") return null;
	const url = clamp(row.link_url, 2000).trim();
	if (!url) return null;
	return {
		url,
		domain: clampOr(row.link_domain, 253, "unknown"),
		title: clamp(row.link_title, 300),
		description: row.link_description ? clamp(row.link_description, 600) : null,
		faviconUrl: row.link_favicon_url ? clamp(row.link_favicon_url, 600) : null,
		scanStatus: toLinkScanStatus(row.link_scan_status),
		scannedAt: row.link_scanned_at,
	};
}

/** The principal an asset or folder belongs to: the entity when it names one, else the person. */
export function ownerIdOf(row: { owner_entity_id: string | null; owner_user_id: string }): string {
	return row.owner_entity_id ?? row.owner_user_id;
}

/**
 * Where the asset's bytes are served from, and its preview thumbnail.
 *
 *  - A LINK opens its own URL and has no bytes to preview.
 *  - A MOUNTED connector asset hands off to the provider's own page.
 *  - An upload that is not `uploaded` (pending, scanning, refused) has nothing to serve — `"#"` is the
 *    sentinel every preview and picker already branches on, where a URL would render as a broken image.
 *  - A PUBLIC bucket object has a stable public address.
 *  - Anything else lives in a PRIVATE bucket and is reached through the object route, which checks the
 *    read and redirects to a short-lived signed URL. A signed URL itself is never stored or
 *    server-rendered: it would stop working while the page that carries it is still open.
 */
export function assetAddress(
	row: Pick<ItemRow, "id" | "source" | "status" | "bucket_id" | "storage_path" | "link_url" | "external_web_url">,
	kind: FileKind,
): { url: string; thumbnailUrl: string | null } {
	if (row.source === "link") return { url: clamp(row.link_url, 2000) || "#", thumbnailUrl: null };
	if (row.source && row.source !== "supabase") {
		return { url: clamp(row.external_web_url, 2000) || "#", thumbnailUrl: null };
	}
	if (row.status !== "uploaded") return { url: "#", thumbnailUrl: null };
	if (isPublicBucket(row.bucket_id)) {
		const url = publicObjectUrl(row.bucket_id, row.storage_path) ?? "#";
		return { url, thumbnailUrl: kind === "image" && url !== "#" ? url : null };
	}
	return {
		url: fileObjectHref(row.id),
		thumbnailUrl: kind === "image" ? fileObjectHref(row.id, { tier: "sm" }) : null,
	};
}

/**
 * The stored extraction envelope, when there is one.
 *
 * `metadata` is `NOT NULL DEFAULT '{}'`, so an empty object means nobody extracted this row — that is
 * `undefined` ("not looked"), distinct from a parsed envelope. A document that does not parse is also
 * `undefined`: the column predates the schema on some rows, and one malformed value must cost the
 * facts, not the page.
 */
export function metadataOf(raw: unknown): AssetMetadata | undefined {
	if (!raw || typeof raw !== "object" || Object.keys(raw as object).length === 0) return undefined;
	const parsed = AssetMetadataSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

// #endregion

// #region Assembly

/** Everything one hub {@link AssetItem} needs that its own row does not carry. */
export interface AssetContext {
	/** The acting viewer's user id — the `canManage` gate (the UPDATE/DELETE policies' predicate). */
	viewerId: string;
	/** Materialised ancestor trails keyed by folder id (the folder's path plus its own name). */
	folderPaths: ReadonlyMap<string, string[]>;
	/** Item ids this viewer has already downloaded. */
	downloaded: ReadonlySet<string>;
	/** The live share link slug per item, for the items the viewer manages. */
	shareSlugs: ReadonlyMap<string, string>;
	/** One instant for the whole page. */
	now: number;
}

/**
 * One registry row as a library asset — an upload or a link, not a message attachment, so it carries
 * no channel, message or sender provenance.
 *
 * `canManage` is `owner_user_id === viewerId`, exactly the predicate the UPDATE and DELETE policies
 * enforce, so the affordance and the write agree by construction. The share slug is disclosed only to
 * someone who may manage the asset: the slug IS the credential, and handing it to every reader would
 * give them a way to propagate it and no way to revoke it.
 */
export function toAssetItem(row: ItemRow, ctx: AssetContext): AssetItem {
	const rawName = (row.display_name ?? row.original_name ?? "").trim();
	const { category, kind, ext } = classify(row, rawName || "untitled");
	const sizeBytes = bytesOf(row.size_bytes);
	const createdMs = Date.parse(row.created_at);
	const created = Number.isNaN(createdMs) ? ctx.now : createdMs;
	const canManage = ctx.viewerId.length > 0 && row.owner_user_id === ctx.viewerId;
	const address = assetAddress(row, kind);

	const item: AssetItem = {
		id: row.id,
		kind,
		category,
		name: clampOr(rawName, 200, "Untitled"),
		ext,
		url: address.url,
		thumbnailUrl: address.thumbnailUrl,
		sizeBytes,
		sizeLabel: clamp(fmtSize(sizeBytes), 16),
		width: null,
		height: null,
		durationLabel: null,

		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,

		createdAt: new Date(created).toISOString(),
		timeLabel: clamp(fmtTime(created), 20),
		dayLabel: clamp(fmtDay(created, ctx.now), 24),
		dateLabel: clamp(fmtDateTime(created), 28),
		starred: row.starred === true,

		source: toAssetSource(row.source),
		status: toFileStatus(row.status),
		visibility: toAssetVisibility(row.visibility),
		ownerType: toAssetOwnerType(row.owner_type),
		ownerId: clampOr(ownerIdOf(row), 80, "unknown"),
		folderId: row.folder_id,
		folderPath: row.folder_id ? (ctx.folderPaths.get(row.folder_id) ?? []) : [],
		contentHash: row.content_hash ? clamp(row.content_hash, 128) : null,
		hashSampled: row.hash_sampled === true,
		external: null,
		link: toLinkAttachment(row),
		shareSlug: canManage ? (ctx.shareSlugs.get(row.id) ?? null) : null,
		downloadCount: Math.max(0, Math.floor(row.download_count ?? 0)),
		downloadedByViewer: ctx.downloaded.has(row.id),
		canManage,
	};
	// A stored preview image already IS the thumbnail; the envelope's facts add the dimensions, a
	// duration and a video's poster, plus the BlurHash the grid shows while the image loads.
	return applyMediaFacts(item, metadataOf(row.metadata));
}

/** A folder's trail: its stored ancestors plus its own name, root-first, bounded like the schema. */
export function folderTrail(row: Pick<FolderRow, "path" | "name">): string[] {
	return [...(row.path ?? []), row.name ?? ""]
		.map((segment) => clamp(segment, 120))
		.filter((segment) => segment.length > 0)
		.slice(0, 24);
}

/** One folder row, with the rollups the caller measured and the share slug the viewer may see. */
export function toAssetFolder(
	row: FolderRow,
	rollup: { itemCount: number; sizeBytes: number },
	ctx: { viewerId: string; shareSlug: string | null },
): AssetFolder {
	const canManage = ctx.viewerId.length > 0 && row.owner_user_id === ctx.viewerId;
	return {
		id: row.id,
		name: clampOr(row.name, 200, "Untitled folder"),
		parentId: row.parent_folder_id,
		path: (row.path ?? []).map((s) => clamp(s, 120)).filter((s) => s.length > 0).slice(0, 24),
		ownerType: toAssetOwnerType(row.owner_type),
		ownerId: clampOr(ownerIdOf(row), 80, "unknown"),
		source: toAssetSource(row.source),
		externalFolderId: row.external_folder_id ? clamp(row.external_folder_id, 200) : null,
		visibility: toAssetVisibility(row.visibility),
		itemCount: rollup.itemCount,
		sizeBytes: rollup.sizeBytes,
		sizeLabel: clamp(fmtSize(rollup.sizeBytes), 16),
		shareSlug: canManage ? ctx.shareSlug : null,
		canManage,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// #endregion
