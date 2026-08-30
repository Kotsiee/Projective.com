import type {
	AssetActor,
	AssetCrumb,
	AssetFolder,
	AssetItem,
	AssetListParams,
	AssetOwnerType,
	AssetSource,
	AssetTreeNode,
	AssetVisibility,
	DownloadEvent,
	DownloadGuard,
	DownloadHistoryPage,
	DownloadVia,
	FileKind,
	FileScope,
	FileSortDir,
	FileSortKey,
	FilesSim,
	FileStatus,
	LinkScanStatus,
	MoveAssets,
	RenameAsset,
	UploadInit,
} from "@projective/types/files";
import { categorizeFile, categoryToKind, wasDownloadedBy } from "@projective/types/files";
import type { FileItem } from "@projective/types/projects";
import { findFilePage } from "../projects/files-fixtures.ts";
import { findConversationFilePage } from "../messaging/workspace-fixtures.ts";
import { mockAvatar, mockCover } from "../../mocks/assets.ts";

/**
 * files assets fixtures — the fat {@link FilesBackendService}'s in-memory answer for the `/files` asset
 * hub while `FILES_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10).
 *
 * **The hub is two things at once, and the corpus reflects that.** It is a personal/entity LIBRARY the
 * owner writes to, and it MOUNTS the attachments of every project channel and conversation the viewer
 * can already read, as read-only sections. Those mounts are not re-invented here: they are DERIVED from
 * `../projects/files-fixtures.ts` and `../messaging/workspace-fixtures.ts`, so a file the hub shows and
 * the same file at `/projects/[id]/files` are one record with one name, one size and one timestamp. A
 * second parallel corpus would drift within a day and there would be no way to tell which was right.
 *
 * Hub-native assets carry NULL provenance (no channel, no message, no sender — they were uploaded, not
 * posted); mounted ones carry all of it. That asymmetry is exactly what `AssetItemSchema` widened
 * `FileItemSchema` to express.
 *
 * No RNG anywhere: a stable string hash seeds every variation and a fixed reference clock keeps SSR and
 * the island's refetch byte-identical. Every hash-derived index uses the UNSIGNED `>>>` shift — a signed
 * `>>` goes negative once a hash passes 2^31, which yields a negative array index, an `undefined` slot
 * and a "….undefined" filename. That exact bug has shipped three times in this repository.
 *
 * Because the hub is a WRITE surface, the derived corpus is seeded into mutable module-level stores so
 * create → upload → rename → move → share → delete round-trips with the gate off. It grants no
 * persistence (per-process, cleared on restart); the RLS-scoped `files.*` tables replace it behind the
 * same gate with zero shape churn.
 */

// #region Reference clock + deterministic helpers
//
// Declared FIRST and used by every builder below. The stores at the bottom of this module are built at
// import time, so anything they call must already be initialised — a helper declared after them would
// be in its temporal dead zone at the moment the corpus is constructed (Decision #49).

/** Fixed reference "now" (never `Date.now()`), matching every sibling fixture module. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIB = 1024 * 1024;

/** A tiny stable hash → non-negative int. Unsigned `>>>` per the module note. */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** Pick a deterministic member of a non-empty list. Always an unsigned index. */
function pick<T>(list: readonly T[], seed: number): T {
	return list[(seed >>> 0) % list.length];
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

/** `Today` / `Yesterday` / `Mon, Jul 14` relative to {@link NOW} (UTC day math). */
function fmtDay(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `Jul 14 · 2:30 PM` — the absolute label the grid hover + list column show. */
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}

/** `m:ss` from a duration in ms. */
function fmtDuration(ms: number): string {
	const total = Math.round(ms / 1000);
	return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/** Human byte size ("2.4 MB") from raw bytes. */
function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

/** Split a filename into its stem and lower-cased extension (no dot). */
function splitName(name: string): { stem: string; ext: string } {
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: "" };
	return { stem: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

// #endregion

// #region The acting principal

/** The acting viewer. Their hub is what `/files` renders and what the quota meters. */
export const HUB_VIEWER: AssetActor = {
	id: "viewer",
	name: "You",
	avatar:
		mockAvatar("photo-1531123897727-8f129e1688ce"),
	handle: "you",
};

/** The library the hub's root resolves to for the acting viewer. */
export const HUB_OWNER_TYPE: AssetOwnerType = "user";
export const HUB_OWNER_ID = HUB_VIEWER.id;

/** Whether an owner reference addresses the acting viewer's own library. */
function isViewerLibrary(ownerType: AssetOwnerType, ownerId: string): boolean {
	return ownerType === HUB_OWNER_TYPE && ownerId === HUB_OWNER_ID;
}

// #endregion

// #region Media + link pools

const IMG = (id: string, w: number, h: number) => ({
	url: mockCover(id, w, h),
	w,
	h,
});

/** A spread of aspect ratios so native-ratio thumbnails vary realistically (§C.4 open registry). */
const PHOTOS = [
	IMG("photo-1618005182384-a83a8bd57fbe", 1200, 800),
	IMG("photo-1558655146-9f40138edfeb", 900, 1200),
	IMG("photo-1550684848-fac1c5b4e853", 1200, 900),
	IMG("photo-1620121692029-d088224ddc74", 1000, 1000),
	IMG("photo-1611262588024-d12430b98920", 1200, 675),
	IMG("photo-1626785774573-4b799315345d", 800, 1000),
	IMG("photo-1517245386807-bb43f82c33c4", 1200, 800),
	IMG("photo-1499951360447-b19be8fe80f5", 1100, 733),
];

/**
 * A **re-hosted** favicon URL in the platform's own public bucket.
 *
 * Never the origin's `/favicon.ico`. Hotlinking would send every viewer's IP address to a host the
 * link's author chose, which turns pasting a link into an IP-harvesting primitive — see the SSRF and
 * re-hosting notes in `./link-scan.ts`.
 */
function favicon(domain: string): string {
	return `/storage/v1/object/public/public_assets/favicons/${domain}.png`;
}

// #endregion

// #region Folder seed

/** One row of the hub-native folder seed: `[id, name, parentId, visibility]`. */
type FolderSeed = readonly [string, string, string | null, AssetVisibility];

/**
 * The hub-native folder tree, parents before children so the materialised `path` can be built in one
 * forward pass. Four levels deep at `Brand → Logos → Exports`, which is enough for the navigator's
 * disclosure, the breadcrumb overflow and a deep-linked URL to all be exercised.
 */
const FOLDER_SEED: readonly FolderSeed[] = [
	["fld-brand", "Brand", null, "private"],
	["fld-brand-logos", "Logos", "fld-brand", "private"],
	["fld-brand-logos-exports", "Exports", "fld-brand-logos", "link"],
	["fld-brand-guidelines", "Guidelines", "fld-brand", "public"],
	["fld-clients", "Clients", null, "private"],
	["fld-clients-northwind", "Northwind", "fld-clients", "private"],
	["fld-clients-northwind-contracts", "Contracts", "fld-clients-northwind", "private"],
	["fld-clients-monarch", "Monarch", "fld-clients", "private"],
	["fld-media", "Media", null, "private"],
	["fld-media-photo", "Photography", "fld-media", "link"],
	["fld-media-audio", "Audio", "fld-media", "private"],
	["fld-reference", "Reference", null, "private"],
	["fld-archive", "Archive", null, "private"],
];

// #endregion

// #region Asset seed

/**
 * One explicitly authored asset. The seed is written out rather than generated so the corpus provably
 * covers every axis the surface branches on — each {@link FileKind}, each {@link AssetSource}, each
 * {@link AssetVisibility}, each {@link FileStatus} and each {@link LinkScanStatus}. A generator would
 * cover most of them most of the time, and "most of the time" is how an unrenderable state ships.
 */
interface AssetSeed {
	id: string;
	name: string;
	kind: FileKind;
	folderId: string | null;
	/** Hours before {@link NOW} the asset was created — keeps the corpus ordered without a clock read. */
	agoHours: number;
	source?: AssetSource;
	visibility?: AssetVisibility;
	status?: FileStatus;
	/** Explicit byte size; omitted derives a plausible one from the kind. */
	sizeBytes?: number;
	starred?: boolean;
	/** For `kind: "link"` assets only. */
	link?: { url: string; domain: string; title: string; desc: string | null; scan: LinkScanStatus };
	/** For connector-mounted assets only — the provider the `external` back-reference points at. */
	external?: { providerSlug: string; connectionId: string; parentId: string | null };
	downloadCount?: number;
}

/** A plausible byte size per kind, deterministic in `seed`. */
function sizeFor(kind: FileKind, seed: number): number {
	const r = seed % 1000;
	switch (kind) {
		case "image":
			return 220_000 + r * 3_200;
		case "video":
			return 8_000_000 + r * 42_000;
		case "audio":
			return 900_000 + r * 7_000;
		case "pdf":
			return 180_000 + r * 6_000;
		case "doc":
			return 40_000 + r * 2_000;
		case "code":
			return 1_200 + r * 90;
		case "archive":
			return 2_400_000 + r * 60_000;
		case "link":
			return 0;
		default:
			return 100_000 + r * 1_000;
	}
}

const ASSET_SEED: readonly AssetSeed[] = [
	// --- Brand: the everyday library, mixed visibility, one starred ---
	{
		id: "as-logo-primary",
		name: "logo-primary.svg",
		kind: "image",
		folderId: "fld-brand-logos",
		agoHours: 5,
		starred: true,
		visibility: "link",
	},
	{
		id: "as-logo-mono",
		name: "logo-monochrome.png",
		kind: "image",
		folderId: "fld-brand-logos",
		agoHours: 7,
	},
	{
		id: "as-logo-pack",
		name: "logo-export-pack.zip",
		kind: "archive",
		folderId: "fld-brand-logos-exports",
		agoHours: 26,
		visibility: "link",
	},
	{
		id: "as-logo-favicons",
		name: "favicon-set.zip",
		kind: "archive",
		folderId: "fld-brand-logos-exports",
		agoHours: 27,
	},
	{
		id: "as-brand-guide",
		name: "brand-guidelines.pdf",
		kind: "pdf",
		folderId: "fld-brand-guidelines",
		agoHours: 52,
		visibility: "public",
		downloadCount: 34,
	},
	{
		id: "as-brand-tokens",
		name: "tokens.json",
		kind: "code",
		folderId: "fld-brand-guidelines",
		agoHours: 55,
		visibility: "public",
	},
	{
		id: "as-brand-theme",
		name: "theme.css",
		kind: "code",
		folderId: "fld-brand-guidelines",
		agoHours: 56,
	},

	// --- Clients: documents, one in-flight and one failed upload ---
	{
		id: "as-nw-msa",
		name: "northwind-msa.pdf",
		kind: "pdf",
		folderId: "fld-clients-northwind-contracts",
		agoHours: 96,
		downloadCount: 3,
	},
	{
		id: "as-nw-sow",
		name: "northwind-scope-of-work.docx",
		kind: "doc",
		folderId: "fld-clients-northwind-contracts",
		agoHours: 98,
	},
	{
		id: "as-nw-notes",
		name: "kickoff-notes.docx",
		kind: "doc",
		folderId: "fld-clients-northwind",
		agoHours: 120,
	},
	{
		id: "as-nw-render",
		name: "atlas-portal-render.mp4",
		kind: "video",
		folderId: "fld-clients-northwind",
		agoHours: 30,
		status: "scanning",
	},
	{
		id: "as-mo-audit",
		name: "monarch-design-audit.pdf",
		kind: "pdf",
		folderId: "fld-clients-monarch",
		agoHours: 200,
	},
	{
		id: "as-mo-upload",
		name: "monarch-system-export.zip",
		kind: "archive",
		folderId: "fld-clients-monarch",
		agoHours: 1,
		status: "pending_upload",
		sizeBytes: 412 * MIB,
	},
	{
		id: "as-mo-broken",
		name: "monarch-legacy-backup.zip",
		kind: "archive",
		folderId: "fld-clients-monarch",
		agoHours: 44,
		status: "error",
	},

	// --- Media: visual + audio, and the quarantine state ---
	{
		id: "as-shoot-01",
		name: "studio-shoot-01.jpg",
		kind: "image",
		folderId: "fld-media-photo",
		agoHours: 12,
		visibility: "link",
	},
	{
		id: "as-shoot-02",
		name: "studio-shoot-02.jpg",
		kind: "image",
		folderId: "fld-media-photo",
		agoHours: 12,
		visibility: "link",
	},
	{
		id: "as-shoot-03",
		name: "studio-shoot-03.jpg",
		kind: "image",
		folderId: "fld-media-photo",
		agoHours: 13,
		visibility: "link",
		starred: true,
	},
	{
		id: "as-shoot-raw",
		name: "shoot-raws.zip",
		kind: "archive",
		folderId: "fld-media-photo",
		agoHours: 14,
		status: "quarantined",
	},
	{
		id: "as-vo-brief",
		name: "client-brief-voicenote.m4a",
		kind: "audio",
		folderId: "fld-media-audio",
		agoHours: 20,
	},
	{
		id: "as-vo-review",
		name: "review-call-recording.mp3",
		kind: "audio",
		folderId: "fld-media-audio",
		agoHours: 68,
	},
	{
		id: "as-reel",
		name: "showreel-2026.mp4",
		kind: "video",
		folderId: "fld-media",
		agoHours: 160,
		visibility: "public",
		downloadCount: 12,
	},

	// --- Reference: link assets, one per LinkScanStatus, each with a re-hosted favicon ---
	{
		id: "as-link-figma",
		name: "Atlas Portal — design file",
		kind: "link",
		folderId: "fld-reference",
		agoHours: 3,
		source: "link",
		visibility: "link",
		link: {
			url: "https://www.figma.com/file/atlas-portal-system",
			domain: "figma.com",
			title: "Atlas Portal — design file",
			desc: "Working file for the Northwind Atlas portal design system.",
			scan: "safe",
		},
	},
	{
		id: "as-link-notion",
		name: "Brand voice guidelines",
		kind: "link",
		folderId: "fld-reference",
		agoHours: 9,
		source: "link",
		link: {
			url: "https://www.notion.so/projective/brand-voice",
			domain: "notion.so",
			title: "Brand voice guidelines",
			desc: null,
			scan: "pending",
		},
	},
	{
		id: "as-link-mirror",
		name: "free-asset-mirror.example",
		kind: "link",
		folderId: "fld-reference",
		agoHours: 40,
		source: "link",
		link: {
			url: "https://free-asset-mirror.example/download/pack",
			domain: "free-asset-mirror.example",
			title: "free-asset-mirror.example",
			desc: null,
			scan: "suspicious",
		},
	},
	{
		id: "as-link-blocked",
		name: "known-phishing.example",
		kind: "link",
		folderId: "fld-reference",
		agoHours: 62,
		source: "link",
		link: {
			url: "https://known-phishing.example/login",
			domain: "known-phishing.example",
			title: "known-phishing.example",
			desc: null,
			scan: "blocked",
		},
	},
	{
		id: "as-link-intranet",
		name: "Client intranet brief",
		kind: "link",
		folderId: "fld-reference",
		agoHours: 88,
		source: "link",
		link: {
			url: "https://intranet.northwind.example/briefs/2026-q3",
			domain: "intranet.northwind.example",
			title: "intranet.northwind.example",
			desc: null,
			scan: "unscannable",
		},
	},

	// --- Archive: the long tail, plus the unclassified `file` kind ---
	{
		id: "as-archive-2025",
		name: "2025-deliverables.zip",
		kind: "archive",
		folderId: "fld-archive",
		agoHours: 900,
	},
	{
		id: "as-archive-blob",
		name: "legacy-export.bin",
		kind: "file",
		folderId: "fld-archive",
		agoHours: 1200,
	},

	// --- Library root: loose recent work ---
	{ id: "as-root-invoice", name: "invoice-2026-07.pdf", kind: "pdf", folderId: null, agoHours: 2 },
	{ id: "as-root-scratch", name: "scratch.ts", kind: "code", folderId: null, agoHours: 4 },

	// --- Connector mounts: one asset per remaining AssetSource, each with an `external` back-ref ---
	{
		id: "as-gd-deck",
		name: "Q3 strategy deck.pdf",
		kind: "pdf",
		folderId: "mnt-google_drive",
		agoHours: 36,
		source: "google_drive",
		external: { providerSlug: "google_drive", connectionId: "cn-google-drive", parentId: null },
	},
	{
		id: "as-gd-sheet",
		name: "Content calendar.xlsx",
		kind: "doc",
		folderId: "mnt-google_drive",
		agoHours: 38,
		source: "google_drive",
		external: { providerSlug: "google_drive", connectionId: "cn-google-drive", parentId: null },
	},
	{
		id: "as-db-photos",
		name: "Client photos.zip",
		kind: "archive",
		folderId: "mnt-dropbox",
		agoHours: 72,
		source: "dropbox",
		external: { providerSlug: "dropbox", connectionId: "cn-dropbox", parentId: null },
	},
	{
		id: "as-fio-cut",
		name: "Launch film — cut 04.mp4",
		kind: "video",
		folderId: "mnt-frameio",
		agoHours: 18,
		source: "frameio",
		external: { providerSlug: "frameio", connectionId: "cn-frameio", parentId: null },
	},
	{
		id: "as-s3-master",
		name: "master-render-4k.mov",
		kind: "video",
		folderId: "mnt-s3",
		agoHours: 140,
		source: "s3",
		external: { providerSlug: "s3", connectionId: "cn-s3", parentId: null },
	},
];

/** The connector mount roots — synthetic, read-only folders the drive sections hang from. */
const DRIVE_MOUNTS: ReadonlyArray<
	{ id: string; label: string; source: AssetSource; connectionId: string }
> = [
	{
		id: "mnt-google_drive",
		label: "Google Drive",
		source: "google_drive",
		connectionId: "cn-google-drive",
	},
	{ id: "mnt-dropbox", label: "Dropbox", source: "dropbox", connectionId: "cn-dropbox" },
	{ id: "mnt-frameio", label: "Frame.io", source: "frameio", connectionId: "cn-frameio" },
	{ id: "mnt-s3", label: "S3 · projective-media", source: "s3", connectionId: "cn-s3" },
];

/** The projects whose channel attachments are mounted into the hub as read-only sections. */
const MOUNTED_PROJECTS: ReadonlyArray<{ slug: string; title: string }> = [
	{ slug: "aurora-rebrand", title: "Aurora Rebrand" },
	{ slug: "northwind-atlas-portal", title: "Northwind Atlas Portal" },
];

// #endregion

// #region Stores
//
// Mutable and module-level so the write path round-trips with the gate off. Everything above this line
// is already initialised by the time these run — the TDZ discipline described in the module note.

/** Every folder, hub-native and synthetic mount alike, keyed by id. */
const FOLDERS = new Map<string, AssetFolder>();
/** Every asset, keyed by id. */
const ASSETS = new Map<string, AssetItem>();
/** Insertion order — the stable tiebreak that keeps paging deterministic when a sort key ties. */
const ORDER: string[] = [];
/** The download ledger. Append-only in the fixtures, exactly as the real table is. */
const DOWNLOADS: DownloadEvent[] = [];
/** Monotonic counters so a minted id never collides with a seeded one. */
let mintCounter = 0;

/** Register an asset in both the map and the order list. */
function put(item: AssetItem): void {
	if (!ASSETS.has(item.id)) ORDER.push(item.id);
	ASSETS.set(item.id, item);
}

/** Materialise a folder's ancestor NAME chain, root-first. Parents are always seeded first. */
function folderPathOf(folderId: string | null): string[] {
	const trail: string[] = [];
	let cursor = folderId;
	let guard = 0;
	while (cursor && guard++ < 24) {
		const folder = FOLDERS.get(cursor);
		if (!folder) break;
		trail.unshift(folder.name);
		cursor = folder.parentId;
	}
	return trail;
}

/** Build one {@link AssetFolder} row. */
function makeFolder(opts: {
	id: string;
	name: string;
	parentId: string | null;
	visibility: AssetVisibility;
	source?: AssetSource;
	externalFolderId?: string | null;
	canManage?: boolean;
	createdAt?: number;
}): AssetFolder {
	const seed = hash(opts.id);
	const created = opts.createdAt ?? NOW - (200 + (seed % 900)) * HOUR;
	return {
		id: opts.id,
		name: opts.name,
		parentId: opts.parentId,
		path: [...folderPathOf(opts.parentId), opts.name],
		ownerType: HUB_OWNER_TYPE,
		ownerId: HUB_OWNER_ID,
		source: opts.source ?? "supabase",
		externalFolderId: opts.externalFolderId ?? null,
		visibility: opts.visibility,
		itemCount: 0,
		sizeBytes: 0,
		sizeLabel: "0 B",
		shareSlug: null,
		canManage: opts.canManage ?? true,
		createdAt: new Date(created).toISOString(),
		updatedAt: new Date(created + 4 * HOUR).toISOString(),
	};
}

// Hub-native folders, then the synthetic connector mounts (read-only by construction).
for (const [id, name, parentId, visibility] of FOLDER_SEED) {
	FOLDERS.set(id, makeFolder({ id, name, parentId, visibility }));
}
for (const mount of DRIVE_MOUNTS) {
	FOLDERS.set(
		mount.id,
		makeFolder({
			id: mount.id,
			name: mount.label,
			parentId: null,
			visibility: "private",
			source: mount.source,
			externalFolderId: "root",
			canManage: false,
		}),
	);
}

/** Build one hub {@link AssetItem} from a seed row. */
function makeSeedAsset(seed: AssetSeed): AssetItem {
	const h = hash(seed.id);
	const created = NOW - seed.agoHours * HOUR;
	const { ext } = splitName(seed.name);
	const isVisual = seed.kind === "image" || seed.kind === "video";
	const photo = pick(PHOTOS, h);
	const bytes = seed.sizeBytes ?? sizeFor(seed.kind, h);
	const source = seed.source ?? "supabase";
	const durMs = seed.kind === "video"
		? (30 + (h % 210)) * 1000
		: seed.kind === "audio"
		? (12 + (h % 180)) * 1000
		: 0;
	const visibility = seed.visibility ?? "private";

	return {
		id: seed.id,
		kind: seed.kind,
		category: categorizeFile(seed.kind === "link" ? "link.url" : seed.name),
		name: seed.name,
		ext: seed.kind === "link" ? "" : ext,
		url: seed.link ? seed.link.url : isVisual ? photo.url : "#",
		thumbnailUrl: isVisual ? photo.url : null,
		sizeBytes: bytes,
		sizeLabel: fmtSize(bytes),
		width: isVisual ? photo.w : null,
		height: isVisual ? photo.h : null,
		durationLabel: durMs ? fmtDuration(durMs) : null,

		// Hub-native assets were UPLOADED, not posted — every provenance field is null. This is the
		// asymmetry `AssetItemSchema` widened `FileItemSchema` to express.
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
		starred: seed.starred ?? false,

		source,
		status: seed.status ?? "uploaded",
		visibility,
		ownerType: HUB_OWNER_TYPE,
		ownerId: HUB_OWNER_ID,
		folderId: seed.folderId,
		folderPath: folderPathOf(seed.folderId),
		// A mounted or link asset holds no bytes of ours, so there is nothing of ours to digest.
		contentHash: source === "supabase" ? hexDigest(seed.id) : null,
		hashSampled: source === "supabase" && bytes > 256 * MIB,
		external: seed.external
			? {
				connectionId: seed.external.connectionId,
				providerSlug: seed.external.providerSlug,
				externalFileId: `ext-${seed.id}`,
				externalParentId: seed.external.parentId,
				externalWebUrl: `https://${seed.external.providerSlug}.example/open/${seed.id}`,
				externalEtag: hexDigest(`etag:${seed.id}`).slice(0, 32),
			}
			: null,
		link: seed.link
			? {
				url: seed.link.url,
				domain: seed.link.domain,
				title: seed.link.title,
				description: seed.link.desc,
				faviconUrl: seed.link.scan === "blocked" ? null : favicon(seed.link.domain),
				scanStatus: seed.link.scan,
				scannedAt: seed.link.scan === "pending" ? null : new Date(created + 4 * MIN).toISOString(),
			}
			: null,
		shareSlug: visibility === "private" ? null : `sh-${seed.id.slice(3)}`,
		downloadCount: seed.downloadCount ?? 0,
		downloadedByViewer: false,
		// The viewer owns their own library; a connector mount is read-only in the hub (see below).
		canManage: source === "supabase" || source === "link",
	};
}

/**
 * A deterministic 64-character lowercase hex digest.
 *
 * NOT a real SHA-256 — it is a stable stand-in so the dedup path has a well-formed value that satisfies
 * `ContentFingerprintSchema`'s regex. The live path digests actual bytes; nothing here may be treated as
 * a cryptographic claim.
 */
function hexDigest(input: string): string {
	let out = "";
	for (let i = 0; i < 8; i++) {
		out += hash(`${input}:${i}`).toString(16).padStart(8, "0");
	}
	return out.slice(0, 64);
}

for (const seed of ASSET_SEED) put(makeSeedAsset(seed));

// #endregion

// #region Mounted sections (read-only)
//
// The hub does not invent a second copy of a project's attachments — it MOUNTS the corpus the projects
// and messaging fixtures already own, so a file shown here and the same file at `/projects/[id]/files`
// are one record. `canManage` is forced false because the mount is read-only AS A PLACE: managing a
// channel attachment happens in the channel, where the message that carries it is.

/** The synthetic folder id a mounted project resolves to. */
function projectMountId(slug: string): string {
	return `mnt-proj-${slug}`;
}

/** The synthetic folder id a mounted channel resolves to. */
function channelMountId(slug: string, channelId: string): string {
	return `mnt-chan-${slug}-${channelId}`;
}

/** Re-own one project/conversation attachment as a read-only hub row. */
function mountFileItem(file: FileItem, folderId: string, trail: string[]): AssetItem {
	return { ...file, folderId, folderPath: trail, canManage: false };
}

for (const project of MOUNTED_PROJECTS) {
	const page = findFilePage({ projectId: project.slug, limit: 200, sort: "date", dir: "desc" });
	if (!page) continue;

	FOLDERS.set(
		projectMountId(project.slug),
		makeFolder({
			id: projectMountId(project.slug),
			name: project.title,
			parentId: null,
			visibility: "link",
			canManage: false,
		}),
	);

	for (const channel of page.channels) {
		if (channel.count === 0) continue;
		FOLDERS.set(
			channelMountId(project.slug, channel.id),
			makeFolder({
				id: channelMountId(project.slug, channel.id),
				name: channel.name,
				parentId: projectMountId(project.slug),
				visibility: "link",
				canManage: false,
			}),
		);
	}

	for (const file of page.items) {
		const folderId = channelMountId(project.slug, file.channelId);
		if (!FOLDERS.has(folderId)) continue;
		put(mountFileItem(file, folderId, [project.title, file.channelName]));
	}
}

// #endregion

// #region Folder rollups
//
// `itemCount` counts DIRECT children while `sizeBytes` totals the whole subtree — the two questions a
// folder card actually answers ("what is in here" and "what does this cost me"). Computed once, after
// every asset is registered, so a rollup can never disagree with the corpus it summarises.

function recomputeFolderStats(): void {
	for (const folder of FOLDERS.values()) {
		folder.itemCount = 0;
		folder.sizeBytes = 0;
	}
	for (const item of ASSETS.values()) {
		if (!item.folderId) continue;
		const direct = FOLDERS.get(item.folderId);
		if (direct) direct.itemCount += 1;
		// Roll the size up through every ancestor.
		let cursor: string | null = item.folderId;
		let guard = 0;
		while (cursor && guard++ < 24) {
			const folder: AssetFolder | undefined = FOLDERS.get(cursor);
			if (!folder) break;
			folder.sizeBytes += item.sizeBytes;
			cursor = folder.parentId;
		}
	}
	for (const folder of FOLDERS.values()) folder.sizeLabel = fmtSize(folder.sizeBytes);
}

recomputeFolderStats();

// #endregion

// #region Simulation overlay

/**
 * Apply the developer {@link FilesSim} overlay to a row.
 *
 * The Dev Context Switcher is a CLIENT seam the server cannot see, so these axes travel as validated
 * query params and are applied HERE, at the moment of projection. The overlay grants no access — it only
 * changes what the developer's own request is answered with, and the live path ignores it entirely.
 */
function applySim(item: AssetItem, sim: FilesSim | undefined): AssetItem {
	if (!sim) return item;
	let next = item;
	if (sim.assetVisibility && next.visibility !== sim.assetVisibility) {
		next = {
			...next,
			visibility: sim.assetVisibility,
			shareSlug: sim.assetVisibility === "private" ? null : next.shareSlug ?? `sh-${next.id}`,
		};
	}
	if (sim.storageProvider && next.source !== "link") {
		next = { ...next, source: sim.storageProvider };
	}
	if (sim.linkScan && next.link) {
		next = {
			...next,
			link: {
				...next.link,
				scanStatus: sim.linkScan,
				scannedAt: sim.linkScan === "pending" ? null : next.link.scannedAt ?? next.createdAt,
			},
		};
	}
	return next;
}

// #endregion

// #region Reads

/** Every asset in insertion order — the stable base every query filters from. */
function allAssets(): AssetItem[] {
	return ORDER.map((id) => ASSETS.get(id)).filter((it): it is AssetItem => it !== undefined);
}

/** Look up one asset by id. */
export function findAsset(id: string): AssetItem | null {
	return ASSETS.get(id) ?? null;
}

/** Look up one folder by id. */
export function findFolder(id: string): AssetFolder | null {
	return FOLDERS.get(id) ?? null;
}

/** Resolve a path of folder NAMES (a deep-linked `/files/a/b/c`) to the folder it addresses. */
export function resolvePath(segments: readonly string[]): AssetFolder | null {
	let parentId: string | null = null;
	let found: AssetFolder | null = null;
	for (const segment of segments) {
		const decoded = decodeURIComponent(segment);
		const match: AssetFolder | undefined = [...FOLDERS.values()].find(
			(f) =>
				f.parentId === parentId &&
				(f.id === decoded || f.name.toLowerCase() === decoded.toLowerCase()),
		);
		if (!match) return null;
		found = match;
		parentId = match.id;
	}
	return found;
}

/**
 * The MiB the acting owner's library consumes.
 *
 * Only assets whose bytes we actually hold count — a connector mount is metered by the provider, and a
 * link stores nothing (`consumesQuota`). Only assets the OWNER owns count either: a mounted channel
 * attachment belongs to whoever posted it, and charging a reader for someone else's upload would make
 * reading a project expensive.
 */
export function usedMibFor(ownerType: AssetOwnerType, ownerId: string): number {
	let bytes = 0;
	for (const item of ASSETS.values()) {
		if (item.source !== "supabase") continue;
		if (item.ownerType !== ownerType || item.ownerId !== ownerId) continue;
		if (item.status === "error") continue;
		bytes += item.sizeBytes;
	}
	return Math.round((bytes / MIB) * 10) / 10;
}

const SORTERS: Record<FileSortKey, (a: AssetItem, b: AssetItem) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	date: (a, b) => a.createdAt.localeCompare(b.createdAt),
	size: (a, b) => a.sizeBytes - b.sizeBytes,
	sender: (a, b) => (a.sender?.name ?? "").localeCompare(b.sender?.name ?? ""),
	type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
};

function sortAssets(items: AssetItem[], sort: FileSortKey, dir: FileSortDir): AssetItem[] {
	const cmp = SORTERS[sort];
	// A stable tiebreak by id keeps paging deterministic when the key ties.
	const sorted = items.slice().sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
	return dir === "desc" ? sorted.reverse() : sorted;
}

/** Whether an asset satisfies the non-location filters of a query. */
function matches(item: AssetItem, params: AssetListParams): boolean {
	if (params.kinds && params.kinds.length > 0 && !params.kinds.includes(item.kind)) return false;
	if (params.sources && params.sources.length > 0 && !params.sources.includes(item.source)) {
		return false;
	}
	if (
		params.visibility && params.visibility.length > 0 &&
		!params.visibility.includes(item.visibility)
	) {
		return false;
	}
	if (params.query) {
		const q = params.query.trim().toLowerCase();
		if (q && !item.name.toLowerCase().includes(q)) return false;
	}
	return true;
}

/** A page slice plus its cursor, shared by every scope's read. */
export interface Slice {
	items: AssetItem[];
	hasMore: boolean;
	nextCursor: string | null;
	total: number;
}

const DEFAULT_LIMIT = 60;

/** Filter, sort and page a candidate set against a query. */
export function sliceAssets(candidates: AssetItem[], params: AssetListParams): Slice {
	const sort = params.sort ?? "date";
	const dir = params.dir ?? (sort === "date" ? "desc" : "asc");
	const sorted = sortAssets(candidates.filter((it) => matches(it, params)), sort, dir);
	const total = sorted.length;

	const limit = Math.min(200, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const idx = sorted.findIndex((it) => it.id === params.cursor);
		start = idx === -1 ? 0 : idx + 1;
	}
	const page = sorted.slice(start, start + limit);
	const hasMore = start + limit < total;
	return {
		items: page,
		hasMore,
		nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
		total,
	};
}

/** The direct child folders of a location, name-ordered. */
export function childFolders(parentId: string | null): AssetFolder[] {
	return [...FOLDERS.values()]
		.filter((f) => f.parentId === parentId)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The assets directly inside a location. */
export function assetsIn(folderId: string | null): AssetItem[] {
	return allAssets().filter((it) => it.folderId === folderId);
}

/** Project the hub rows for a scope read, with the sim overlay applied at the boundary. */
export function projectRows(items: AssetItem[], sim: FilesSim | undefined): AssetItem[] {
	return sim ? items.map((it) => applySim(it, sim)) : items;
}

/**
 * A page of a project's or conversation's attachments, mapped into the hub's row shape.
 *
 * Delegates to the corpus that already owns those attachments rather than reading the hub store, so the
 * hub agrees with EVERY project and conversation, not only the two mounted into the library tree.
 */
export function scopedAttachments(
	scope: FileScope,
	subjectId: string,
	channelId: string | null,
): AssetItem[] | null {
	if (scope === "conversation") {
		const page = findConversationFilePage({ projectId: subjectId, limit: 200 });
		return page ? page.items.map((f) => ({ ...f, canManage: false })) : null;
	}
	const page = findFilePage({ projectId: subjectId, channelId, limit: 200 });
	return page ? page.items.map((f) => ({ ...f, canManage: false })) : null;
}

// #endregion

// #region Tree

/** Total assets beneath a folder, including every descendant. */
function subtreeCount(folderId: string): number {
	let count = 0;
	for (const item of ASSETS.values()) {
		let cursor: string | null = item.folderId;
		let guard = 0;
		while (cursor && guard++ < 24) {
			if (cursor === folderId) {
				count += 1;
				break;
			}
			const folder: AssetFolder | undefined = FOLDERS.get(cursor);
			cursor = folder ? folder.parentId : null;
		}
	}
	return count;
}

/** Build the recursive node for one hub-native folder. */
function folderNode(folder: AssetFolder, readOnly: boolean): AssetTreeNode {
	return {
		segment: folder.id,
		kind: "dir",
		nodeKind: readOnly ? "mount" : "folder",
		label: folder.name,
		sublabel: null,
		folderId: folder.id,
		readOnly,
		fileCount: subtreeCount(folder.id),
		children: childFolders(folder.id).map((child) => folderNode(child, readOnly)),
	};
}

/**
 * The `/files` navigation tree.
 *
 * Three sections in one array, deliberately not merged: the owner's LIBRARY (writable), the MOUNTED
 * engagements (read-only), and the CONNECTED drives (read-only). Flattening them into one root would
 * make "my files" contain things the owner cannot rename, delete or count against their quota.
 */
export function buildTree(ownerType: AssetOwnerType, ownerId: string): AssetTreeNode[] {
	const mine = isViewerLibrary(ownerType, ownerId);
	const mountedIds = new Set<string>(DRIVE_MOUNTS.map((m) => m.id));
	for (const project of MOUNTED_PROJECTS) mountedIds.add(projectMountId(project.slug));

	const libraryChildren = childFolders(null)
		.filter((f) => !mountedIds.has(f.id))
		.map((f) => folderNode(f, false));

	const root: AssetTreeNode = {
		segment: "root",
		kind: "stage",
		nodeKind: "root",
		label: mine ? "My files" : "Library",
		sublabel: null,
		avatar: mine ? HUB_VIEWER.avatar : null,
		handle: mine ? HUB_VIEWER.handle : null,
		folderId: null,
		readOnly: false,
		fileCount: allAssets().filter((it) => {
			if (!it.folderId) return true;
			return !isMountedFolder(it.folderId);
		}).length,
		children: libraryChildren,
	};

	const projectNodes: AssetTreeNode[] = [];
	for (const project of MOUNTED_PROJECTS) {
		const folder = FOLDERS.get(projectMountId(project.slug));
		if (!folder) continue;
		projectNodes.push({
			segment: folder.id,
			kind: "stage",
			nodeKind: "project",
			label: folder.name,
			sublabel: "Shared in this engagement",
			folderId: folder.id,
			readOnly: true,
			fileCount: subtreeCount(folder.id),
			children: childFolders(folder.id).map((channel) => ({
				segment: channel.id,
				kind: "unit",
				nodeKind: "channel" as const,
				label: channel.name,
				sublabel: null,
				folderId: channel.id,
				readOnly: true,
				fileCount: subtreeCount(channel.id),
				children: [],
			})),
		});
	}

	const driveNodes: AssetTreeNode[] = DRIVE_MOUNTS.map((mount) => {
		const folder = FOLDERS.get(mount.id);
		return {
			segment: mount.id,
			kind: "stage",
			nodeKind: "drive" as const,
			label: mount.label,
			sublabel: "Connected account",
			folderId: mount.id,
			readOnly: true,
			fileCount: folder ? subtreeCount(folder.id) : 0,
			children: [],
		};
	});

	return [root, ...projectNodes, ...driveNodes];
}

/** Whether a folder belongs to a read-only mounted section (a project, a channel, a drive). */
export function isMountedFolder(folderId: string): boolean {
	return folderId.startsWith("mnt-");
}

// #endregion

// #region Breadcrumbs

/** The breadcrumb trail to a folder, root-first, already scope-correct. */
export function crumbsFor(folderId: string | null, base = "/files"): AssetCrumb[] {
	const chain: AssetFolder[] = [];
	let cursor = folderId;
	let guard = 0;
	while (cursor && guard++ < 24) {
		const folder = FOLDERS.get(cursor);
		if (!folder) break;
		chain.unshift(folder);
		cursor = folder.parentId;
	}
	const crumbs: AssetCrumb[] = [{ id: null, label: "My files", href: base }];
	let href = base;
	for (const folder of chain) {
		href = `${href}/${encodeURIComponent(folder.id)}`;
		crumbs.push({ id: folder.id, label: folder.name, href });
	}
	return crumbs;
}

// #endregion

// #region Writes
//
// Optimistic and per-process. Every mutation refreshes the folder rollups so a card's count and size
// can never lag the corpus they summarise.

/** Mint a stable, collision-free id for a newly created row. */
function mintId(prefix: string, seed: string): string {
	mintCounter += 1;
	return `${prefix}-${hash(`${seed}:${mintCounter}`).toString(36)}${mintCounter}`;
}

/** Create a folder. Returns `null` when the parent does not exist or is a read-only mount. */
export function createFolderRow(input: {
	name: string;
	parentId: string | null;
	ownerType: AssetOwnerType;
	ownerId: string;
	visibility?: AssetVisibility;
}): AssetFolder | null {
	if (input.parentId) {
		const parent = FOLDERS.get(input.parentId);
		if (!parent || !parent.canManage) return null;
	}
	const parent = input.parentId ? FOLDERS.get(input.parentId) : undefined;
	const id = mintId("fld", input.name);
	const folder = makeFolder({
		id,
		name: input.name.trim(),
		parentId: input.parentId,
		// An omitted scope INHERITS the parent's, which is the only non-surprising default: creating a
		// subfolder inside a public folder and finding it private would silently break every link into it.
		visibility: input.visibility ?? parent?.visibility ?? "private",
		createdAt: NOW,
	});
	FOLDERS.set(id, folder);
	recomputeFolderStats();
	return folder;
}

/** Rename an asset. The extension is preserved — a person edits the name, not the type. */
export function renameAssetRow(input: RenameAsset): AssetItem | null {
	const item = ASSETS.get(input.assetId);
	if (!item || !item.canManage) return null;
	const { ext } = splitName(item.name);
	const stem = splitName(input.name.trim()).stem || input.name.trim();
	const name = ext ? `${stem}.${ext}` : stem;
	const next: AssetItem = { ...item, name, category: categorizeFile(name) };
	ASSETS.set(next.id, next);
	return next;
}

/** Move assets into a folder. Silently skips rows the viewer may not manage. */
export function moveAssetRows(input: MoveAssets): number {
	const target = input.targetFolderId ? FOLDERS.get(input.targetFolderId) : null;
	if (input.targetFolderId && (!target || !target.canManage)) return 0;
	let moved = 0;
	for (const id of input.assetIds) {
		const item = ASSETS.get(id);
		if (!item || !item.canManage) continue;
		ASSETS.set(id, {
			...item,
			folderId: input.targetFolderId,
			folderPath: folderPathOf(input.targetFolderId),
		});
		moved += 1;
	}
	if (moved) recomputeFolderStats();
	return moved;
}

/**
 * Delete assets.
 *
 * Nothing is hard-deleted (root CLAUDE.md §5): the live path stamps `files.items.deleted_at`, so a
 * deletion is recoverable and a share link pointing at the asset stops resolving rather than 500ing.
 * The fixtures model that by dropping the row from the store while the ledger and the share record keep
 * their reference — which is exactly the state the "this link no longer resolves" path has to handle.
 */
export function deleteAssetRows(assetIds: readonly string[]): number {
	let removed = 0;
	for (const id of assetIds) {
		const item = ASSETS.get(id);
		if (!item || !item.canManage) continue;
		ASSETS.delete(id);
		const idx = ORDER.indexOf(id);
		if (idx !== -1) ORDER.splice(idx, 1);
		removed += 1;
	}
	if (removed) recomputeFolderStats();
	return removed;
}

/**
 * Change the privacy scope of assets and folders in one operation.
 *
 * De-escalation is always explicit (it is this call, never a side effect), so an asset can never
 * silently lose reach something else already depends on. Raising to a non-private scope mints a slug
 * only if the row has none — re-sharing must not rotate a URL people already hold.
 */
export function setVisibilityRows(
	assetIds: readonly string[],
	folderIds: readonly string[],
	visibility: AssetVisibility,
): AssetItem[] {
	const touched: AssetItem[] = [];
	for (const id of assetIds) {
		const item = ASSETS.get(id);
		if (!item || !item.canManage) continue;
		const next: AssetItem = {
			...item,
			visibility,
			shareSlug: visibility === "private" ? null : item.shareSlug ?? mintId("sh", id),
		};
		ASSETS.set(id, next);
		touched.push(next);
	}
	for (const id of folderIds) {
		const folder = FOLDERS.get(id);
		if (!folder || !folder.canManage) continue;
		folder.visibility = visibility;
		folder.shareSlug = visibility === "private" ? null : folder.shareSlug ?? mintId("sh", id);
		folder.updatedAt = new Date(NOW).toISOString();
	}
	return touched;
}

/**
 * Mint the `pending_upload` row an upload ticket addresses.
 *
 * A row exists from the FIRST moment, before any bytes move — so an abandoned upload is a visible,
 * sweepable `pending_upload` rather than an orphaned object nobody has a record of.
 */
export function createPendingAsset(input: UploadInit): AssetItem {
	const id = mintId("as", input.name);
	const { ext } = splitName(input.name);
	const category = categorizeFile(input.name, input.mimeType);
	const kind = categoryToKind(category);
	const item: AssetItem = {
		id,
		kind,
		category,
		name: input.name,
		ext,
		url: "#",
		thumbnailUrl: null,
		sizeBytes: input.sizeBytes,
		sizeLabel: fmtSize(input.sizeBytes),
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
		createdAt: new Date(NOW).toISOString(),
		timeLabel: fmtTime(NOW),
		dayLabel: fmtDay(NOW),
		dateLabel: fmtDateTime(NOW),
		starred: false,
		source: "supabase",
		status: "pending_upload",
		visibility: input.visibility,
		ownerType: input.ownerType,
		ownerId: input.ownerId,
		folderId: input.folderId,
		folderPath: folderPathOf(input.folderId),
		contentHash: input.fingerprint?.hash ?? null,
		hashSampled: input.fingerprint?.sampled ?? false,
		external: null,
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: true,
	};
	put(item);
	recomputeFolderStats();
	return item;
}

/**
 * Promote a landed object out of quarantine.
 *
 * The fixtures go straight to `uploaded`; the live path lands the object in `quarantine` as `scanning`
 * and only a clean virus/MIME check promotes it. Modelling the terminal state here keeps the surface
 * exercisable without pretending the scan happened.
 */
export function completeUpload(assetId: string): AssetItem | null {
	const item = ASSETS.get(assetId);
	if (!item) return null;
	const isVisual = item.kind === "image" || item.kind === "video";
	const photo = pick(PHOTOS, hash(item.id));
	const next: AssetItem = {
		...item,
		status: "uploaded",
		url: isVisual ? photo.url : "#",
		thumbnailUrl: isVisual ? photo.url : null,
		width: isVisual ? photo.w : null,
		height: isVisual ? photo.h : null,
	};
	ASSETS.set(assetId, next);
	recomputeFolderStats();
	return next;
}

/** Store a resolved web link as a first-class asset. */
export function createLinkAsset(input: {
	url: string;
	domain: string;
	title: string;
	description: string | null;
	faviconUrl: string | null;
	scanStatus: LinkScanStatus;
	folderId: string | null;
	ownerType: AssetOwnerType;
	ownerId: string;
}): AssetItem {
	const id = mintId("as-link", input.url);
	const item: AssetItem = {
		id,
		kind: "link",
		category: categorizeFile("link.url"),
		name: input.title || input.domain,
		ext: "",
		url: input.url,
		thumbnailUrl: null,
		// A link stores no bytes at all — it must never be able to consume a byte of quota.
		sizeBytes: 0,
		sizeLabel: "0 B",
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
		createdAt: new Date(NOW).toISOString(),
		timeLabel: fmtTime(NOW),
		dayLabel: fmtDay(NOW),
		dateLabel: fmtDateTime(NOW),
		starred: false,
		source: "link",
		status: "uploaded",
		visibility: "private",
		ownerType: input.ownerType,
		ownerId: input.ownerId,
		folderId: input.folderId,
		folderPath: folderPathOf(input.folderId),
		contentHash: null,
		hashSampled: false,
		external: null,
		link: {
			url: input.url,
			domain: input.domain,
			title: input.title,
			description: input.description,
			faviconUrl: input.faviconUrl,
			scanStatus: input.scanStatus,
			scannedAt: input.scanStatus === "pending" ? null : new Date(NOW).toISOString(),
		},
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: true,
	};
	put(item);
	return item;
}

/** Register an externally-mounted object as a hub row (the connector import path). */
export function importExternalAsset(item: AssetItem): AssetItem {
	put(item);
	recomputeFolderStats();
	return item;
}

// #endregion

// #region Download ledger

/**
 * Whether the acting viewer has already taken a copy.
 *
 * Signed-in identity wins over the device token: the same person on a new browser has still downloaded
 * it. An unidentifiable caller gets `false` — inheriting a stranger's history would be worse than
 * asking twice.
 */
export function downloadGuardFor(
	assetId: string,
	actorId: string | null,
	deviceFingerprint: string | null,
): DownloadGuard {
	const already = wasDownloadedBy(DOWNLOADS, assetId, actorId, deviceFingerprint);
	if (!already) return { alreadyDownloaded: false, lastAt: null, lastDeviceLabel: null };
	const prior = DOWNLOADS.filter((e) => e.assetId === assetId).sort((a, b) =>
		b.at.localeCompare(a.at)
	);
	const last = prior[0];
	return {
		alreadyDownloaded: true,
		lastAt: last?.at ?? null,
		// Deliberately vague — enough to jog a memory, never enough to profile a person's devices.
		lastDeviceLabel: last
			? last.deviceFingerprint && last.deviceFingerprint === deviceFingerprint
				? "this browser"
				: "another device"
			: null,
	};
}

/** Append a download to the ledger and bump the asset's counter. */
export function recordDownloadEvent(params: {
	assetId: string;
	actorId: string | null;
	actorHandle: string | null;
	deviceFingerprint: string | null;
	via: DownloadVia;
	shareSlug: string | null;
}): DownloadEvent | null {
	const item = ASSETS.get(params.assetId);
	if (!item) return null;
	const at = NOW + DOWNLOADS.length * MIN;
	const event: DownloadEvent = {
		id: mintId("dl", params.assetId),
		assetId: item.id,
		// Denormalised on purpose: the ledger has to stay readable after the asset is renamed, and an
		// owner auditing a leak needs the name the file had when it left.
		assetName: item.name,
		actorId: params.actorId,
		actorHandle: params.actorHandle,
		via: params.via,
		shareSlug: params.shareSlug,
		deviceFingerprint: params.deviceFingerprint,
		at: new Date(at).toISOString(),
		dateLabel: fmtDateTime(at),
	};
	DOWNLOADS.push(event);
	ASSETS.set(item.id, {
		...item,
		downloadCount: item.downloadCount + 1,
		downloadedByViewer: item.downloadedByViewer || params.actorId === HUB_OWNER_ID,
	});
	return event;
}

/** A cursor-paged slice of the ledger for one asset, one actor, or the whole library. */
export function downloadHistory(params: {
	assetId?: string;
	actorId?: string;
	cursor?: string | null;
	limit?: number;
}): DownloadHistoryPage {
	let matched = DOWNLOADS.slice();
	if (params.assetId) matched = matched.filter((e) => e.assetId === params.assetId);
	if (params.actorId) matched = matched.filter((e) => e.actorId === params.actorId);
	matched.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

	const total = matched.length;
	const limit = Math.min(200, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const idx = matched.findIndex((e) => e.id === params.cursor);
		start = idx === -1 ? 0 : idx + 1;
	}
	const page = matched.slice(start, start + limit);
	const hasMore = start + limit < total;
	return {
		events: page,
		hasMore,
		nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
		total,
	};
}

// #endregion

// #region Dedup

/**
 * Find an asset in an owner's library with the same content digest.
 *
 * A SAMPLED digest match is returned as a candidate but is never authoritative — two files sharing a
 * head window, a tail window and a length are very probably the same file and absolutely not certainly
 * the same file. The caller must re-digest in full before collapsing two rows onto one stored object: a
 * false positive there does not save a copy, it silently replaces one person's file with someone else's.
 */
export function findByHash(
	ownerType: AssetOwnerType,
	ownerId: string,
	digest: string,
): AssetItem | null {
	for (const item of ASSETS.values()) {
		if (item.ownerType !== ownerType || item.ownerId !== ownerId) continue;
		if (item.contentHash && item.contentHash === digest) return item;
	}
	return null;
}

/**
 * The first stored asset this owner holds — the stand-in `existing` row the `dedupState` dev axis
 * hands to a simulated duplicate verdict.
 *
 * Deliberately restricted to `source === "supabase"`: only a platform-stored object can BE a
 * duplicate of an upload. A mounted Drive file or a link stores no bytes of ours, so offering one as
 * the thing you already have would demonstrate a resolution ("replace") that cannot happen.
 * A soft-deleted row cannot appear here because the corpus never projects one.
 */
export function anyOwnedAsset(
	ownerType: AssetOwnerType,
	ownerId: string,
): AssetItem | null {
	for (const item of ASSETS.values()) {
		if (item.ownerType !== ownerType || item.ownerId !== ownerId) continue;
		if (item.source !== "supabase") continue;
		return item;
	}
	return null;
}

/** Find an asset already sitting at a name inside a folder — the collision half of the pre-flight. */
export function findByName(
	ownerType: AssetOwnerType,
	ownerId: string,
	folderId: string | null,
	name: string,
): AssetItem | null {
	const needle = name.trim().toLowerCase();
	for (const item of ASSETS.values()) {
		if (item.ownerType !== ownerType || item.ownerId !== ownerId) continue;
		if ((item.folderId ?? null) !== (folderId ?? null)) continue;
		if (item.name.toLowerCase() === needle) return item;
	}
	return null;
}

// #endregion
