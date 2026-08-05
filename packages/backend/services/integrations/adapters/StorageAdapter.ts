import type { AssetFolder, AssetItem, AssetSource, FileKind } from "@projective/types/files";
import { categorizeFile } from "@projective/types/files";
import type { UserConnection } from "@projective/types/integrations";

/**
 * StorageAdapter — the one interface every storage connector implements, and the seam that keeps a
 * connected Google Drive from becoming a second file model.
 *
 * **The adapter returns `AssetItem` and `AssetFolder`, never a provider row.** That is the whole point:
 * the picker, the grid, the table and the preview modal are then literally the same components for a
 * mounted Drive file and a hub-native upload, and the two cannot drift apart in how they are drawn. A
 * connector-shaped return type would need a second card family within a week.
 *
 * **Paging is the PROVIDER's, not ours.** `cursor` is their opaque continuation token echoed back
 * verbatim — a connector that pages by token cannot be resumed from an id we invented, and normalising
 * one into the other loses rows silently at the boundary.
 *
 * **A location is addressed two ways because the two families genuinely differ.** Object stores (Drive,
 * Dropbox, Frame.io) have folder objects with ids; key-prefix stores (S3) have no folder objects at all,
 * only a delimiter convention. {@link DrivePath} carries both rather than forcing one into the other,
 * which would either invent ids or discard the prefix.
 *
 * Every adapter is stub-first behind `isIntegrationsBackendLive()` and documents the exact provider API
 * surface its live branch will call, so wiring one is a matter of filling in a documented call rather
 * than rediscovering the contract.
 */

// #region Contract

/**
 * A location inside a connected drive. Exactly one of the two fields is meaningful per provider; both
 * `null` addresses the root.
 */
export interface DrivePath {
	/** The provider's own folder id (a Drive file id, a Frame.io asset id). */
	folderId: string | null;
	/** A key prefix, for providers that address by prefix rather than by folder object (S3). */
	path: string | null;
}

/** One level of a connected drive, already projected into the hub's row shapes. */
export interface StorageListing {
	entries: AssetItem[];
	folders: AssetFolder[];
	hasMore: boolean;
	/** The provider's own continuation token, echoed back verbatim. */
	nextCursor: string | null;
}

/**
 * A storage connector.
 *
 * `downloadUrl` and `thumbnailUrl` return **short-lived, provider-minted** URLs and are deliberately
 * async and per-call: caching one on the asset row would persist a credential-bearing URL into a
 * projection the client reads, and a signed URL that outlives its purpose is a leaked capability.
 */
export interface StorageAdapter {
	/** The `integrations.providers.slug` this adapter serves. */
	readonly slug: string;
	/** The `AssetSource` a row it produces carries. */
	readonly source: AssetSource;
	/** List one level. */
	list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing>;
	/** One object's full row, or `null` when the provider no longer has it. */
	metadata(id: string): Promise<AssetItem | null>;
	/** A short-lived download URL, or `null` when the provider will not mint one. */
	downloadUrl(id: string): Promise<string | null>;
	/** A short-lived thumbnail URL, or `null` when the object has no visual preview. */
	thumbnailUrl(id: string): Promise<string | null>;
}

/** What an adapter is constructed with — the connection whose consent it acts under. */
export interface StorageAdapterContext {
	connection: UserConnection;
	/**
	 * The decrypted provider access token.
	 *
	 * `null` in every stub path, and it must STAY null anywhere the live gate is off — an adapter that
	 * reads a token it was not given is an adapter that will one day fetch with someone else's.
	 * Retrieved through `../token-vault.ts`, service-role only, and never logged.
	 */
	accessToken: string | null;
}

/** Constructs an adapter for a connection. */
export type StorageAdapterFactory = (ctx: StorageAdapterContext) => StorageAdapter;

// #endregion

// #region Shared row construction
//
// Every adapter builds its rows through these, so a mounted object from any provider is shaped
// identically. A provider-local builder would be where the drift starts.

/** Fixed reference "now" (never `Date.now()`), matching every sibling fixture module. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const HOUR = 3_600_000;

/** A tiny stable hash → non-negative int. Unsigned `>>>` (a signed `>>` goes negative past 2^31). */
export function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `h:mm AM/PM` (UTC components — server-tz-independent, so SSR == the client refetch). */
function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** `Jul 14 · 2:30 PM`. */
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}

/** `Today` / `Mon, Jul 14` relative to {@link NOW}. */
function fmtDay(ms: number): string {
	const diff = Math.floor(NOW / 86_400_000) - Math.floor(ms / 86_400_000);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
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

/** Lower-cased extension, no dot. */
function extOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Map a rich category onto the coarse rendering bucket via the files SSOT. */
function kindOf(name: string): FileKind {
	const category = categorizeFile(name);
	// `categoryToKind` lives in the same module as `categorizeFile`; resolving through the category
	// keeps one classification path rather than a second extension table living out here.
	return CATEGORY_KIND[category] ?? "file";
}

/**
 * The minimum category→kind map the adapters need.
 *
 * Deliberately NOT a copy of `CATEGORY_META`: it defaults to `file` for anything unlisted, so a new
 * category added to the files domain degrades to the generic glyph here rather than failing a lookup.
 */
const CATEGORY_KIND: Readonly<Record<string, FileKind>> = {
	Image: "image",
	Video: "video",
	Audio: "audio",
	PDF: "pdf",
	Document: "doc",
	Spreadsheet: "doc",
	Presentation: "doc",
	Code: "code",
	Data: "code",
	Archive: "archive",
};

/**
 * Build one mounted asset row.
 *
 * `sizeBytes` is real and reported, but the object is counted against the PROVIDER's quota, never ours
 * — `consumesQuota` returns false for any non-`supabase` source, which is what keeps a 200 GB connected
 * Drive from appearing to fill a 25 GB platform allowance.
 */
export function externalAsset(opts: {
	connection: UserConnection;
	source: AssetSource;
	externalFileId: string;
	externalParentId: string | null;
	name: string;
	sizeBytes: number;
	agoHours: number;
	webUrl: string;
	thumbnailUrl?: string | null;
	folderId?: string | null;
}): AssetItem {
	const created = NOW - opts.agoHours * HOUR;
	const name = opts.name;
	const kind = kindOf(name);
	return {
		id: `${opts.source}:${opts.externalFileId}`,
		kind,
		category: categorizeFile(name),
		name,
		ext: extOf(name),
		// A mounted object is opened AT THE PROVIDER. Handing back our own URL would imply we hold bytes
		// we do not, and would break the moment the owner moves the file at the far end.
		url: opts.webUrl,
		thumbnailUrl: opts.thumbnailUrl ?? null,
		sizeBytes: opts.sizeBytes,
		sizeLabel: fmtSize(opts.sizeBytes),
		width: null,
		height: null,
		durationLabel: null,

		// Mounted objects were never posted in a message — every provenance field is null.
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,

		createdAt: new Date(created).toISOString(),
		timeLabel: fmtTime(created),
		dayLabel: fmtDay(created),
		dateLabel: fmtDateTime(created),
		starred: false,

		source: opts.source,
		status: "uploaded",
		// A mounted object's real access is governed at the provider. `private` is the honest projection:
		// claiming a platform visibility we do not enforce would be a promise we cannot keep.
		visibility: "private",
		ownerType: "user",
		ownerId: opts.connection.userId,
		folderId: opts.folderId ?? null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: {
			connectionId: opts.connection.id,
			providerSlug: opts.connection.providerSlug,
			externalFileId: opts.externalFileId,
			externalParentId: opts.externalParentId,
			// The provider's own "open in Drive/Dropbox" URL — the only safe way to hand off.
			externalWebUrl: opts.webUrl,
			// The connector's change token: the delta cursor that lets a re-browse skip an object whose
			// bytes have not moved.
			externalEtag: hash(`${opts.externalFileId}:${opts.sizeBytes}`).toString(16),
		},
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		// Read-only in the hub, always. The hub shows a connected drive so a person can FIND and attach
		// what they already have — not so it becomes a second write path into someone else's system of
		// record, where a rename here would silently rename a file their whole team depends on.
		canManage: false,
	};
}

/** Build one mounted folder row. */
export function externalFolder(opts: {
	connection: UserConnection;
	source: AssetSource;
	externalFolderId: string;
	name: string;
	parentId: string | null;
	itemCount: number;
}): AssetFolder {
	const created = NOW - (100 + (hash(opts.externalFolderId) % 800)) * HOUR;
	return {
		id: `${opts.source}:${opts.externalFolderId}`,
		name: opts.name,
		parentId: opts.parentId,
		path: [opts.name],
		ownerType: "user",
		ownerId: opts.connection.userId,
		source: opts.source,
		externalFolderId: opts.externalFolderId,
		visibility: "private",
		itemCount: opts.itemCount,
		// A mounted folder holds none of OUR bytes, so its subtree size against our storage is zero.
		sizeBytes: 0,
		sizeLabel: "0 B",
		shareSlug: null,
		canManage: false,
		createdAt: new Date(created).toISOString(),
		updatedAt: new Date(created + 6 * HOUR).toISOString(),
	};
}

// #endregion
