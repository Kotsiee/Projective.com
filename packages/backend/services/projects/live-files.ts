import type { SupabaseClient } from "supabaseClient";
import type {
	FileChannelRef,
	FileItem,
	FileKind,
	FileListPage,
	FileListParams,
	FileSortDir,
	FileSortKey,
} from "@projective/types/projects";
import type {
	AssetOwnerType,
	AssetSource,
	AssetVisibility,
	FileCategory,
	FileStatus,
	LinkAttachment,
	LinkScanStatus,
} from "@projective/types/files";
import { categoryToKind, describeFile, messageAttachmentFacets } from "@projective/types/files";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	filesDb,
	projectsDb,
	senderOf,
} from "./live-support.ts";

/**
 * live-files — the RLS-scoped Postgres read path for `ProjectBackendService.files(params)`.
 *
 * It is the SQL half of the File Explorer read (`/projects/[projectId]/files` and the channel-scoped
 * `/projects/[projectId]/[channelId]/files`), mirroring `./files-fixtures.ts` shape-for-shape. Every
 * query runs under the caller's own JWT through the helpers in `./live-support.ts`, so
 * `comms.has_channel_access` and `files.fn_can_read` decide what comes back. Nothing here uses the
 * service-role client.
 *
 * ## The central difficulty: why the rows come from `message_attachments`, not `channel_files`
 *
 * `FileItemSchema` is `AssetItemSchema.extend({...})` — a NARROWING that re-mandates `channelId`,
 * `channelName`, `channelKind`, `messageId`, `messageText` and `sender` as non-null `min(1)`. The
 * obvious source, `comms.channel_files`, carries `(channel_type, channel_id, attachment_id)` and
 * **no `message_id` column at all**, so a row sourced from it can satisfy the broader `AssetItem`
 * and can never satisfy `FileItem`: `messageId` would have to be invented, and an invented message
 * id is a carousel group the preview modal will try to open.
 *
 * So the corpus is sourced from `comms.message_attachments` — which DOES carry `message_id` — joined
 * in TypeScript to `comms.project_messages` (for `channel_id`, `body`, `sender_user_id`) and to
 * `files.items` (for the asset itself). That is the only path that can populate the required
 * provenance from real columns.
 *
 * **Out of scope, explicitly:** a file attached at CHANNEL level with no message — a
 * `comms.channel_files` row with no `comms.message_attachments` twin — cannot be represented by this
 * projection and is not returned. It is representable as an `AssetItem` and belongs to the `/files`
 * hub read, which does not re-mandate provenance.
 *
 * ## Three vocabularies that look interchangeable and are not
 *
 * - `comms.message_attachments.message_table` uses the SCHEMA-QUALIFIED strings
 *   `'comms.project_messages'` / `'comms.dm_messages'`, while `comms.channel_files.channel_type`
 *   uses the BARE strings `'project'` / `'dm'` for the same concept. Two spellings of one idea in
 *   one schema; matching the wrong one returns zero rows rather than an error.
 * - `comms.message_attachments` has **no foreign key on `message_id`** (Postgres cannot point one
 *   column at two parents), so PostgREST cannot embed it in either direction. It always needs its
 *   own keyed query, which is why the read below is a fan-out and not a join.
 * - `comms.project_messages.has_attachments` is declared `NOT NULL DEFAULT false` and **no trigger
 *   or function anywhere maintains it**. `.eq("has_attachments", true)` therefore reads like a free
 *   narrowing and is in fact a filter that matches nothing. It is deliberately not used.
 *
 * ## No cross-schema embedding
 *
 * `projects`, `comms`, `files` and `org` are four exposed schema profiles, and the schema profile is
 * mandatory on every call (`.schema("comms")` etc. via the `live-support` helpers) — without it the
 * request 404s on the table name in a way that does not say why. Cross-schema resource embedding is
 * broker-version-dependent and would additionally need each FK named to avoid `PGRST201`, so every
 * hop is a second `.in()` query stitched in TypeScript. `marketplace` and `integrations` are not
 * exposed at all, which is why {@link toExternalRef} can never resolve a provider slug.
 *
 * ## Filtering, sorting and paging happen in memory, like the fixtures
 *
 * Three of the five sort keys are not columns of any single table: `sender` is a composed name from
 * `org.users_public`, and `type` is `kind`/`ext`, both DERIVED here from the filename and MIME. So
 * an `ORDER BY` could only ever implement two of the five, and a page ordered two different ways
 * depending on the key is worse than one that is bounded. The corpus is fetched under
 * {@link MESSAGE_ROW_CAP}/{@link ATTACHMENT_ROW_CAP} newest-first, then filtered, sorted and paged
 * exactly as `findFilePage` does — same comparators, same id tiebreak, same cursor semantics.
 */

// #region Constants

/**
 * The `message_table` discriminator for a project-channel message.
 *
 * Spelled once, as a constant, because the bare `'project'` spelling that `comms.channel_files` uses
 * for the same concept is a plausible-looking value that returns an empty page instead of an error.
 */
const PROJECT_MESSAGE_TABLE = "comms.project_messages";

/**
 * How many channels of one project are considered.
 *
 * A generous ceiling — a project with more rooms than this has a navigation problem before it has a
 * paging one — stated here rather than left to PostgREST's `max_rows = 1000`, so the number is
 * visible to a reader instead of being a property of a config file three directories away.
 */
const CHANNEL_ROW_CAP = 200;

/**
 * The newest-first window of messages the corpus is drawn from.
 *
 * Deliberately well under PostgREST's `max_rows = 1000`. Each cap becomes the length of a keyed
 * `.in()` list on the NEXT hop, and a `.in()` list is serialised into the request URL: a thousand
 * uuids is roughly 37 KB of query string, which is past the header buffer of a default reverse
 * proxy. Failing that way produces a 4xx with no rows in it, which reads exactly like an empty
 * channel.
 *
 * The consequence, stated rather than hidden: in a channel with far more chatter than attachments,
 * the corpus is the attachments of the newest {@link MESSAGE_ROW_CAP} messages, not of all time.
 * That agrees with the default sort (`date`/`desc`) and disagrees with an `asc` sort deep in a very
 * old channel — a real bound, not an invisible one.
 */
const MESSAGE_ROW_CAP = 400;

/** The attachment ceiling, which also bounds the `files.items` and secondary `.in()` lists. */
const ATTACHMENT_ROW_CAP = 400;

/** Page size when the caller does not ask for one. Matches `findFilePage`. */
const DEFAULT_LIMIT = 60;

/** The `FileListParamsSchema.limit` ceiling, restated so a caller that skipped Zod cannot exceed it. */
const MAX_LIMIT = 200;

/** Canonical uuid shape — see {@link resolveProject} for why a slug must never reach a uuid column. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `comms.project_channels` columns. There is no `kind` column — see {@link toChannelKind}. */
const CHANNEL_COLUMNS = "id, name, stage_id, visibility, created_at";

/** `comms.project_messages` columns. `has_attachments` is deliberately absent — see the docblock. */
const MESSAGE_COLUMNS = "id, channel_id, sender_user_id, body, is_audio, created_at";

/** `comms.message_attachments` columns. */
const ATTACHMENT_COLUMNS = "id, message_id, attachment_id, created_at";

/**
 * `files.items` columns, verified against `00000010_tables_files.sql`.
 *
 * Wider than the asset registry's minimum because `AssetItemSchema` requires roughly thirty base
 * fields, and every one of these is a real column: withholding them and defaulting the projection
 * would make a mounted Drive file, a quarantined upload and a plain attachment render identically.
 */
const ITEM_COLUMNS = [
	"id",
	"display_name",
	"original_name",
	"mime_type",
	"size_bytes",
	"category",
	"status",
	"source",
	"visibility",
	"owner_type",
	"owner_user_id",
	"owner_entity_id",
	"folder_id",
	"starred",
	"content_hash",
	"hash_sampled",
	"share_slug",
	"download_count",
	"link_url",
	"link_domain",
	"link_title",
	"link_description",
	"link_favicon_url",
	"link_scan_status",
	"link_scanned_at",
].join(", ");

// #endregion

// #region Row shapes

/** One `comms.project_channels` row as selected by {@link CHANNEL_COLUMNS}. */
interface ChannelRow {
	id: string;
	name: string;
	stage_id: string | null;
	visibility: string | null;
	created_at: string;
}

/** One `comms.project_messages` row as selected by {@link MESSAGE_COLUMNS}. */
interface MessageRow {
	id: string;
	channel_id: string;
	sender_user_id: string;
	body: string | null;
	is_audio: boolean | null;
	created_at: string;
}

/** One `comms.message_attachments` row as selected by {@link ATTACHMENT_COLUMNS}. */
interface AttachmentRow {
	id: string;
	message_id: string;
	attachment_id: string;
	created_at: string;
}

/** One `files.items` row as selected by {@link ITEM_COLUMNS}. */
interface ItemRow {
	id: string;
	display_name: string | null;
	original_name: string | null;
	mime_type: string | null;
	/** `bigint` — some PostgREST/driver combinations hand a bigint back as a decimal string. */
	size_bytes: number | string | null;
	category: string | null;
	status: string | null;
	source: string | null;
	visibility: string | null;
	owner_type: string | null;
	owner_user_id: string;
	owner_entity_id: string | null;
	folder_id: string | null;
	starred: boolean | null;
	content_hash: string | null;
	hash_sampled: boolean | null;
	share_slug: string | null;
	download_count: number | null;
	link_url: string | null;
	link_domain: string | null;
	link_title: string | null;
	link_description: string | null;
	link_favicon_url: string | null;
	link_scan_status: string | null;
	link_scanned_at: string | null;
}

/** One `files.folders` row, for the materialised breadcrumb trail. */
interface FolderRow {
	id: string;
	name: string | null;
	path: string[] | null;
}

// #endregion

// #region Labels

/*
 * Every pre-formatted label below is derived from UTC components (`getUTC*`), never from `Intl` and
 * never from local time. The server renders these once and the island re-renders them on its own
 * refetch; if the two disagreed by a timezone the list would visibly rewrite itself after hydration.
 * The fixtures document the same rule and use the same formats, so a page cannot change shape when
 * the gate flips.
 */

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** `h:mm AM/PM` from an epoch instant, in UTC. */
function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * `Today` / `Yesterday` / `Mon, Jul 14`, relative to `now`.
 *
 * `now` is a parameter rather than a `Date.now()` inside the loop so that every row on one page is
 * dated against ONE instant. A page that straddled a UTC midnight mid-render would otherwise show
 * two different meanings of "Today" in the same list.
 */
function fmtDay(ms: number, now: number): string {
	const diff = Math.floor(now / DAY_MS) - Math.floor(ms / DAY_MS);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `Jul 14 · 2:30 PM` — the grid hover reveal and the list's date column. */
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}

/** Human byte size ("2.4 MB"). Matches `findFilePage`'s formatter so the two never disagree. */
function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

// #endregion

// #region Enum coercion

/*
 * `files.file_source`, `file_visibility`, `file_status`, `owner_kind` and `file_category` mirror
 * their Zod counterparts member-for-member and in the same order (`00000004_enums_domains.sql` says
 * so explicitly). These coercions are therefore guards against a FUTURE member reaching a client as
 * an unparseable row, not translations — unlike the reconciliations in `./live-support.ts`, where
 * the two vocabularies genuinely disagree today.
 *
 * Each fallback is chosen so that being wrong is quiet rather than misleading.
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
function toAssetSource(raw: string | null | undefined): AssetSource {
	return (raw && ASSET_SOURCES.has(raw) ? raw : "supabase") as AssetSource;
}

const FILE_STATUSES: ReadonlySet<string> = new Set([
	"pending_upload",
	"scanning",
	"uploaded",
	"error",
	"quarantined",
]);

/**
 * Unknown → `uploaded`.
 *
 * The row only reached this projection because it is attached to a message somebody sent, so it is
 * not sitting in the quarantine landing zone. `error` would paint a failure state onto a file that
 * is fine, and the explorer draws that state prominently.
 */
function toFileStatus(raw: string | null | undefined): FileStatus {
	return (raw && FILE_STATUSES.has(raw) ? raw : "uploaded") as FileStatus;
}

const VISIBILITIES: ReadonlySet<string> = new Set(["private", "link", "public"]);

/** Unknown → `private`, the narrowest reading. A privacy scope must never widen by accident. */
function toAssetVisibility(raw: string | null | undefined): AssetVisibility {
	return (raw && VISIBILITIES.has(raw) ? raw : "private") as AssetVisibility;
}

const OWNER_KINDS: ReadonlySet<string> = new Set(["user", "team", "business", "organisation"]);

/** Unknown → `user`, matching the column's own default and the `owner_entity_id IS NULL` case. */
function toAssetOwnerType(raw: string | null | undefined): AssetOwnerType {
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
 * `files.items.link_scan_status` → the Zod `LinkScanStatus`.
 *
 * The column is NULLABLE and NULL means something the Zod enum cannot say: "the safety pipeline has
 * never been queued for this link", as distinct from `pending` ("queued, no verdict yet"). There is
 * no member for the former, so NULL lands on `pending` — the only value that neither vouches for the
 * link nor accuses it, which is exactly the state of a link nobody has looked at.
 */
function toLinkScanStatus(raw: string | null | undefined): LinkScanStatus {
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
 * The rich category for a row, the coarse {@link FileKind} that must agree with it, and the
 * extension.
 *
 * `files.items.category` is the authoritative column — the upload path is specified to write
 * `describeFile().category` into it — but it is `NOT NULL DEFAULT 'Other'`, and `'Other'` is
 * indistinguishable from "never classified". Since there is no live upload path yet, every real row
 * today reads `'Other'`. So a stored value wins whenever it is anything BUT that unclassified
 * default, and otherwise the same pure classifier the writer would have used is run here.
 *
 * `describeFile` rather than `categorizeFile` alone: it is the same classifier plus the extension
 * and the category's `CATEGORY_META` bucket in one call, which is what makes `kind` and `category`
 * provably agree instead of being two independent derivations that can fork.
 *
 * `source === "link"` overrides `kind` to `link`: no category maps to that bucket (a link has no
 * bytes to classify), and it is the kind the explorer's glyph and preview both branch on. Its `ext`
 * is empty for the same reason — a URL has no extension, and the schema documents `""` for links.
 */
function classify(row: ItemRow, rawName: string): {
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

// #region Channel mapping

/** The `ChannelKind` vocabulary, taken from the projection rather than re-imported. */
type ChannelKind = FileItem["channelKind"];

/**
 * `comms.project_channels` → the projection's four-member `ChannelKind`.
 *
 * There is **no `kind` column**; the shape has to be read off another one, and only two of the four
 * members are reachable at all:
 *
 *  - `stage_id IS NULL` → `general`, a whole-project room.
 *  - `stage_id IS NOT NULL` → `stage`.
 *  - `team` and `dm` are UNREACHABLE from this table, and that is structural rather than an
 *    omission. A DM lives in `comms.dm_threads`/`dm_messages`, which this endpoint does not read at
 *    all — a DM attachment belongs to the messaging domain's own file read. A team-owned channel
 *    has no table anywhere.
 *
 * The near-miss worth naming: `visibility` carries `'team_private'` and `'business_private'`
 * alongside `'project_all'`, and mapping `team_private` to `team` is tempting. It is declined
 * deliberately — those two values sub-divide a STAGE room by side of the market, saying WHO may
 * enter rather than what KIND of room it is. Filing a stage's talent side under the tree's Teams
 * group would separate it from the stage siblings a reader navigates it by.
 */
function toChannelKind(row: ChannelRow): ChannelKind {
	return row.stage_id ? "stage" : "general";
}

/** A channel descriptor with a zero count; the count is filled once the corpus is resolved. */
function toChannelRef(row: ChannelRow): FileChannelRef {
	return {
		id: clampOr(row.id, 120, row.id),
		// `min(1)`, and `name` is unbounded text — a blank one has to resolve to a word rather than
		// to an empty tree node the reader cannot click.
		name: clampOr(row.name, 160, "Channel"),
		kind: toChannelKind(row),
		count: 0,
	};
}

// #endregion

// #region Asset facets with no source column

/**
 * The `external` back-reference for a mounted connector asset. Always `null`.
 *
 * `ExternalRefSchema` requires `providerSlug` as `min(1)`, and that value lives on
 * `integrations.user_connections.provider_slug` — in a schema `supabase/config.toml` does **not**
 * expose to PostgREST, so it cannot be read from here at all. The whole nullable object is therefore
 * withheld rather than filled with a placeholder slug: a card that says "Dropbox" about a Drive file
 * is worse than one that says nothing, and `source` (a real column, faithfully mapped) already tells
 * the reader the asset is mounted rather than stored.
 */
function toExternalRef(): null {
	return null;
}

/**
 * The `link` facet for a `source = 'link'` asset, from the real `link_*` columns.
 *
 * Returns `null` when `link_url` is absent. The `items_link_url_check` CONSTRAINT makes that
 * unrepresentable for a link asset, so this branch guards against a row that is not one — the schema
 * requires `url` and `domain` as `min(1)`, and a link object with neither is a parse failure that
 * would take the whole page down rather than lose one card.
 */
function toLinkAttachment(row: ItemRow): LinkAttachment | null {
	if (row.source !== "link") return null;
	const url = clamp(row.link_url, 2000).trim();
	if (!url) return null;
	return {
		url,
		// `min(1)`, so the absence has to be spelled. The URL's own host is deliberately not parsed
		// out as a fallback: `link_domain` is the REGISTRABLE domain the ingest pipeline resolved,
		// and a naive host split would print "www.figma.com" beside rows that print "figma.com".
		domain: clampOr(row.link_domain, 253, "unknown"),
		title: clamp(row.link_title, 300),
		description: row.link_description ? clamp(row.link_description, 600) : null,
		faviconUrl: row.link_favicon_url ? clamp(row.link_favicon_url, 600) : null,
		scanStatus: toLinkScanStatus(row.link_scan_status),
		scannedAt: row.link_scanned_at,
	};
}

// #endregion

// #region Row assembly

/** Everything one {@link FileItem} needs that does not come from its own three rows. */
interface AssemblyContext {
	/** Display parties keyed by `user_id`, from `org.users_public`. */
	parties: Awaited<ReturnType<typeof fetchParties>>;
	/** Materialised ancestor trails keyed by folder id. */
	folderPaths: Map<string, string[]>;
	/** Item ids this viewer has already downloaded. */
	downloaded: ReadonlySet<string>;
	/** The acting viewer's user id — the `canManage` and inline-rename gate. */
	viewerId: string;
	/** One instant for the whole page, so `dayLabel` cannot mean two things in one list. */
	now: number;
}

/**
 * Stitch one attachment row, its message, its channel and its asset registry row into a `FileItem`.
 *
 * ## The row id is the ATTACHMENT, not the asset
 *
 * `AssetItemSchema.id` is documented as the asset id, but the same `files.items` row can be attached
 * to two different messages, and this projection renders one row per PROVENANCE — so an asset
 * attached twice is legitimately two entries with two channels, two timestamps and two senders.
 * Keying on the asset id would collide in the grid, collide in the modal's carousel group, and break
 * the cursor (which matches on `id`). `comms.message_attachments.id` is the id of the PAIRING, which
 * is what a row here actually is, and it matches the fixtures — whose ids are `${messageId}-${i}`,
 * one per attachment and not one per asset.
 *
 * ## Fields returned NEUTRAL because no column can answer them
 *
 *  - **`url` (`"#"`) and `thumbnailUrl` (`null`).** The `project` bucket is seeded `public = false`,
 *    so no derivable public URL exists; serving one means minting a signed URL per row through the
 *    Storage API, which is a files-domain concern behind its own gate. `"#"` is the established
 *    sentinel for "no real source" that `FilePreview`, `AssetPicker`, `FilesHub` and
 *    `AudioVisualizer` all already branch on, and the fixtures already emit it for every
 *    non-previewable asset — so this degrades into a code path the UI has. A guessed public path on
 *    a private bucket would 404 on every row, which renders as a broken image rather than a glyph.
 *  - **`width` / `height` / `durationLabel` (`null`).** Intrinsic media dimensions live nowhere:
 *    `files.items.metadata` is an unconstrained `jsonb` with no documented key convention and no
 *    writer anywhere in the migrations. Probing speculative keys would assert a contract that does
 *    not exist. (`width`/`height` are `.positive()` besides, so a stored `0` would FAIL the parse —
 *    any future reader of that column must map `0` to `null` rather than pass it through.)
 *  - **`external` (`null`).** See {@link toExternalRef}.
 *
 * ## Fields answered from a real column, with the reading stated
 *
 *  - **`messageAudioUrl`.** `comms.project_messages.is_audio` records that the message IS a voice
 *    note; no column carries a playable URL for it. `"#"` is emitted when the flag is set — the same
 *    sentinel the fixtures use for exactly this case, and the one `AudioVisualizer` reads as "there
 *    is a recording, but no source" — so the fact survives without a URL being invented.
 *  - **`starred`.** `files.items.starred` is the OWNER's shelf mark, not a per-viewer one (the
 *    column's own comment flags this). A non-owner therefore sees the owner's star. Synthesising a
 *    per-viewer value would need a `(user_id, item_id)` pivot that does not exist.
 *  - **`visibility`.** The stored scope, RAISED to `link` when it reads `private`, and never
 *    lowered and never raised past `link`. Attachment into a channel IS the elevation condition the
 *    privacy hierarchy specifies, and `messageAttachmentFacets` encodes exactly that as its default;
 *    but no write path performs the elevation yet, so a real row can still read `private` while
 *    every member of the channel can open it. Passing that through would print "Only you" on a file
 *    the whole room can see.
 *  - **`shareSlug`.** Disclosed only to a viewer who may manage the asset. The slug IS the
 *    credential — `files.fn_can_read` deliberately refuses `link` visibility precisely so an item id
 *    cannot be traded for access — and handing the token to every project member who can read the
 *    file gives them a way to propagate it outside the project and no way to revoke it. Narrower
 *    than the schema's "present when not private", and deliberately so.
 *  - **`canManage`.** `owner_user_id === viewerId`, which is exactly the predicate the `files.items`
 *    UPDATE and DELETE policies enforce, so the affordance and the write agree by construction.
 *  - **`createdAt`.** The MESSAGE's timestamp, not the asset's. `files.items.created_at` is when the
 *    bytes were uploaded and can long predate a re-attachment; the explorer's date column means
 *    "when did this appear in this channel". Siblings of one message therefore share an instant, and
 *    the id tiebreak in {@link sortItems} keeps their order stable.
 */
function toFileItem(
	attachment: AttachmentRow,
	message: MessageRow,
	channel: ChannelRow,
	item: ItemRow,
	ctx: AssemblyContext,
): FileItem {
	// Classified from the UNCLAMPED name: clamping to the field's 200-character bound could cut the
	// extension off a pathological filename, and an `ext` that disagrees with the `name` beside it
	// makes both the type filter and the glyph wrong.
	const rawName = (item.display_name ?? item.original_name ?? "").trim();
	const { category, kind, ext } = classify(item, rawName || "untitled");

	const sizeRaw = typeof item.size_bytes === "string" ? Number(item.size_bytes) : item.size_bytes;
	const sizeBytes = typeof sizeRaw === "number" && Number.isFinite(sizeRaw) && sizeRaw > 0
		? Math.floor(sizeRaw)
		: 0;

	const createdMs = Date.parse(message.created_at);
	// A row whose timestamp will not parse still has to render: falling back to the page's own
	// instant keeps `createdAt` a valid ISO string — every consumer sorts and groups on it — rather
	// than emitting "Invalid Date" into three label fields.
	const created = Number.isNaN(createdMs) ? ctx.now : createdMs;

	const canManage = ctx.viewerId.length > 0 && item.owner_user_id === ctx.viewerId;
	const stored = toAssetVisibility(item.visibility);

	return {
		id: attachment.id,
		kind,
		category,
		// `min(1)`, so a blank display name has to resolve to something. "Untitled" rather than the
		// id: a uuid is not a filename, and this is the string an inline rename would be seeded with.
		name: clampOr(rawName, 200, "Untitled"),
		ext,
		url: "#",
		thumbnailUrl: null,
		sizeBytes,
		sizeLabel: clamp(fmtSize(sizeBytes), 16),
		width: null,
		height: null,
		durationLabel: null,

		channelId: clampOr(channel.id, 120, channel.id),
		channelName: clampOr(channel.name, 160, "Channel"),
		channelKind: toChannelKind(channel),
		messageId: clampOr(message.id, 120, message.id),
		messageText: clamp(message.body, 4000),
		messageAudioUrl: message.is_audio ? "#" : null,
		sender: senderOf(message.sender_user_id, ctx.parties.get(message.sender_user_id)),

		createdAt: new Date(created).toISOString(),
		timeLabel: clamp(fmtTime(created), 20),
		dayLabel: clamp(fmtDay(created, ctx.now), 24),
		dateLabel: clamp(fmtDateTime(created), 28),
		starred: item.starred === true,

		// The fifteen hub facets come from the SSOT's own helper rather than being restated field by
		// field, so a facet added to `AssetHubFacets` arrives here with its intended default instead
		// of failing to compile into a hand-rolled literal. The five it takes as options are the five
		// this read can answer; the nine immediately below it are overridden because they are real
		// columns on `files.items`, which the helper — written for a fixture that mints its own
		// assets — necessarily hard-codes.
		...messageAttachmentFacets(clampOr(item.owner_entity_id ?? item.owner_user_id, 80, "unknown"), {
			visibility: stored === "private" ? "link" : stored,
			canManage,
			shareSlug: canManage && item.share_slug ? clamp(item.share_slug, 64) : null,
			downloadCount: Math.max(0, Math.floor(item.download_count ?? 0)),
			downloadedByViewer: ctx.downloaded.has(item.id),
		}),
		source: toAssetSource(item.source),
		status: toFileStatus(item.status),
		ownerType: toAssetOwnerType(item.owner_type),
		folderId: item.folder_id,
		folderPath: item.folder_id ? (ctx.folderPaths.get(item.folder_id) ?? []) : [],
		contentHash: item.content_hash ? clamp(item.content_hash, 128) : null,
		hashSampled: item.hash_sampled === true,
		external: toExternalRef(),
		link: toLinkAttachment(item),
	};
}

// #endregion

// #region Secondary lookups

/*
 * Both lookups below degrade rather than throw. Each answers a question the page is better for
 * having and can render without — a missing folder trail costs a breadcrumb, a missing download
 * ledger costs a duplicate-download prompt — and turning a secondary lookup into an outage of the
 * primary surface is the failure mode `live-queries.ts` avoids by the same rule.
 */

/**
 * Materialised ancestor trails for the folders a page's assets sit in.
 *
 * `files.folders.path` is the folder's OWN ancestor list, root-first, so an item's trail is that
 * path plus the folder's own name. Skipped entirely when no asset on the page has a folder — the
 * common case here, since a channel attachment is normally filed nowhere.
 */
async function fetchFolderPaths(
	db: SupabaseClient,
	folderIds: readonly string[],
): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	if (folderIds.length === 0) return out;

	const { data, error } = await db
		.from("folders")
		.select("id, name, path")
		.in("id", folderIds as string[]);

	if (error) return out;
	for (const row of (data ?? []) as FolderRow[]) {
		const trail = [...(row.path ?? []), row.name ?? ""]
			.map((segment) => clamp(segment, 120))
			.filter((segment) => segment.length > 0)
			.slice(0, 24);
		out.set(row.id, trail);
	}
	return out;
}

/**
 * The subset of a page's assets this viewer has already downloaded.
 *
 * `AssetItem.downloadedByViewer` is documented as "on this device", and a device fingerprint is a
 * CLIENT fact this read never receives — `files.download_events.device_fingerprint` is written by
 * the download path and is not resolvable from a session. So the question answered here is the
 * account-level one: has this person ever taken a copy. That OVER-reports (a second device shows the
 * prompt where it need not), which is the harmless direction — an unnecessary confirmation is
 * friction, a missing one silently loses the feature.
 */
async function fetchDownloadedItemIds(
	db: SupabaseClient,
	actor: ReadActor,
	itemIds: readonly string[],
): Promise<Set<string>> {
	const out = new Set<string>();
	if (itemIds.length === 0 || !actor.userId) return out;

	const { data, error } = await db
		.from("download_events")
		.select("item_id")
		.eq("actor_user_id", actor.userId)
		.in("item_id", itemIds as string[]);

	if (error) return out;
	for (const row of (data ?? []) as { item_id: string }[]) out.add(row.item_id);
	return out;
}

// #endregion

// #region Filter, sort, page

/** Filename and kind narrowing, matching `findFilePage`'s `matches` predicate exactly. */
function matches(item: FileItem, params: FileListParams): boolean {
	if (params.kinds && params.kinds.length > 0 && !params.kinds.includes(item.kind)) return false;
	if (params.query) {
		const q = params.query.trim().toLowerCase();
		if (q && !item.name.toLowerCase().includes(q)) return false;
	}
	return true;
}

/** The five sort comparators. Identical to the fixture's, so a gate flip cannot reorder a page. */
const SORTERS: Record<FileSortKey, (a: FileItem, b: FileItem) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	date: (a, b) => a.createdAt.localeCompare(b.createdAt),
	size: (a, b) => a.sizeBytes - b.sizeBytes,
	sender: (a, b) => a.sender.name.localeCompare(b.sender.name),
	type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
};

/**
 * Sort with a stable id tiebreak, then reverse for `desc`.
 *
 * The tiebreak is not cosmetic. `date` ties for every sibling of one message — they share the
 * message's instant — and a cursor paging through an order the engine is free to vary between calls
 * would skip and repeat rows across page boundaries.
 */
function sortItems(items: FileItem[], sort: FileSortKey, dir: FileSortDir): FileItem[] {
	const cmp = SORTERS[sort];
	const sorted = items.slice().sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
	return dir === "desc" ? sorted.reverse() : sorted;
}

// #endregion

// #region Project resolution

/**
 * The project's real uuid, from the `projectId` route param.
 *
 * That param is a **slug**, not an id — `findProjectDetail(params.projectId)` matches on `p.slug`,
 * and the `/projects/{slug}` route has carried a slug since Decision #21. Everything downstream keys
 * on `comms.project_channels.project_id`, which is a uuid, so the two have to be reconciled here.
 *
 * A uuid is accepted as a fallback for a caller that already holds one, and the {@link UUID_RE} guard
 * on that branch is load-bearing rather than tidy: sending a slug to a uuid column is not a query
 * that returns nothing, it is `22P02 invalid input syntax for type uuid`, which surfaces as a thrown
 * page read for the ordinary case of a mistyped URL.
 *
 * `maybeSingle` rather than `single`: a slug matching nothing is an ordinary 404 on this route, and
 * `single` turns it into a thrown PostgREST error the caller would have to unwrap to tell "no such
 * project" apart from "the database is down".
 */
async function resolveProject(
	db: SupabaseClient,
	projectId: string,
): Promise<{ id: string; slug: string } | null> {
	const bySlug = await db
		.from("projects")
		.select("id, slug")
		.eq("slug", projectId)
		.maybeSingle();

	if (bySlug.error) {
		throw new Error(`projects.projects slug read failed: ${bySlug.error.message}`);
	}
	if (bySlug.data) return bySlug.data as unknown as { id: string; slug: string };

	if (!UUID_RE.test(projectId)) return null;

	const byId = await db
		.from("projects")
		.select("id, slug")
		.eq("id", projectId)
		.maybeSingle();

	if (byId.error) throw new Error(`projects.projects id read failed: ${byId.error.message}`);
	return byId.data ? byId.data as unknown as { id: string; slug: string } : null;
}

// #endregion

// #region Entry point

/**
 * One page of project-channel attachments, or `null` when the project does not resolve.
 *
 * `null` means "no such project, or none this viewer may see", and the route maps it to a 404. Every
 * other emptiness is a VALID page: a project whose channels the viewer cannot enter, a channel id
 * matching nothing, and a channel with no attachments all return a page with no items, because the
 * explorer has an empty state for each and a 404 would tell the reader the project is gone.
 *
 * The read is four keyed hops — project → channels → messages → attachments → assets — with the
 * party, folder and download lookups fanned out in parallel once the asset ids are known. The first
 * four hops THROW on failure: each is primary, and an empty page served because
 * `comms.project_messages` was unreachable is a lie the caller cannot detect. The calling service
 * catches, logs and falls back to fixtures.
 *
 * An attachment whose `files.items` row does not come back is SKIPPED, never half-rendered. RLS can
 * legitimately withhold it — `files.fn_can_read` grants a project mount only for a `project`-bucket
 * asset whose storage path anchors on the project id, and deliberately does NOT honour `link`
 * visibility, since the share slug is the credential rather than the item id — and a soft-deleted
 * asset is withheld too. Without that row there is no name, size, category or owner, every one of
 * which the projection requires.
 */
export async function fetchFilePage(
	actor: ReadActor & { accessToken: string },
	params: FileListParams,
): Promise<FileListPage | null> {
	const projects = projectsDb(actor);
	const comms = commsDb(actor);
	const files = filesDb(actor);

	const project = await resolveProject(projects, params.projectId);
	if (!project) return null;

	// --- Channels -------------------------------------------------------------------------------
	const channelRead = await comms
		.from("project_channels")
		.select(CHANNEL_COLUMNS)
		.eq("project_id", project.id)
		.order("created_at", { ascending: true })
		.limit(CHANNEL_ROW_CAP);

	if (channelRead.error) {
		throw new Error(`comms.project_channels read failed: ${channelRead.error.message}`);
	}

	const allChannels = (channelRead.data ?? []) as unknown as ChannelRow[];
	const requestedChannelId = params.channelId ?? null;
	// Narrowed in TypeScript rather than with a second `.eq()`, exactly as `corpusFor` does: the
	// channel id reaching this service may be a fixture-shaped string rather than a uuid, and a
	// non-uuid `.eq()` against a uuid column raises 22P02 instead of matching nothing.
	const scopedChannels = requestedChannelId
		? allChannels.filter((row) => row.id === requestedChannelId)
		: allChannels;

	const channelById = new Map(scopedChannels.map((row) => [row.id, row]));
	const now = Date.now();

	/** A valid, empty page. Every early exit below is an empty CHANNEL, never a missing project. */
	const emptyPage = (): FileListPage => ({
		scope: requestedChannelId ? "channel" : "project",
		projectId: clampOr(params.projectId, 120, project.slug),
		channelId: requestedChannelId ? clamp(requestedChannelId, 120) : null,
		items: [],
		channels: scopedChannels.map(toChannelRef),
		hasMore: false,
		nextCursor: null,
		total: 0,
		viewerId: clamp(actor.userId, 80),
	});

	if (scopedChannels.length === 0) return emptyPage();

	// --- Messages -------------------------------------------------------------------------------
	// `has_attachments` is NOT used to narrow this: the column has no writer anywhere in the
	// migrations, so it is `false` on every row, and filtering on it would return an empty corpus
	// that looks exactly like a project nobody has ever attached anything to.
	const messageRead = await comms
		.from("project_messages")
		.select(MESSAGE_COLUMNS)
		.in("channel_id", [...channelById.keys()])
		.is("deleted_at", null)
		.order("created_at", { ascending: false })
		.limit(MESSAGE_ROW_CAP);

	if (messageRead.error) {
		throw new Error(`comms.project_messages read failed: ${messageRead.error.message}`);
	}

	const messages = (messageRead.data ?? []) as unknown as MessageRow[];
	if (messages.length === 0) return emptyPage();
	const messageById = new Map(messages.map((row) => [row.id, row]));

	// --- Attachments ----------------------------------------------------------------------------
	// The schema-qualified discriminator, never the bare `'project'` that `comms.channel_files` uses
	// for the same idea. There is no FK on `message_id`, so this cannot be an embed under any
	// PostgREST version — it is always its own keyed query.
	const attachmentRead = await comms
		.from("message_attachments")
		.select(ATTACHMENT_COLUMNS)
		.eq("message_table", PROJECT_MESSAGE_TABLE)
		.in("message_id", [...messageById.keys()])
		.order("created_at", { ascending: false })
		.limit(ATTACHMENT_ROW_CAP);

	if (attachmentRead.error) {
		throw new Error(`comms.message_attachments read failed: ${attachmentRead.error.message}`);
	}

	const attachments = (attachmentRead.data ?? []) as unknown as AttachmentRow[];
	if (attachments.length === 0) return emptyPage();

	// --- Assets ---------------------------------------------------------------------------------
	const assetIds = [...new Set(attachments.map((row) => row.attachment_id))];
	const itemRead = await files
		.from("items")
		.select(ITEM_COLUMNS)
		.in("id", assetIds)
		.is("deleted_at", null);

	if (itemRead.error) throw new Error(`files.items read failed: ${itemRead.error.message}`);

	const itemById = new Map(
		((itemRead.data ?? []) as unknown as ItemRow[]).map((row) => [row.id, row]),
	);
	if (itemById.size === 0) return emptyPage();

	// --- Secondary lookups, fanned out together -------------------------------------------------
	const readableIds = [...itemById.keys()];
	const folderIds = [
		...new Set(
			[...itemById.values()]
				.map((row) => row.folder_id)
				.filter((id): id is string => !!id),
		),
	];
	const [parties, folderPaths, downloaded] = await Promise.all([
		fetchParties(actor, messages.map((row) => row.sender_user_id)),
		fetchFolderPaths(files, folderIds),
		fetchDownloadedItemIds(files, actor, readableIds),
	]);

	const ctx: AssemblyContext = {
		parties,
		folderPaths,
		downloaded,
		viewerId: actor.userId,
		now,
	};

	// --- Assemble the corpus --------------------------------------------------------------------
	const corpus: FileItem[] = [];
	for (const attachment of attachments) {
		const message = messageById.get(attachment.message_id);
		if (!message) continue;
		const channel = channelById.get(message.channel_id);
		if (!channel) continue;
		const item = itemById.get(attachment.attachment_id);
		// Withheld by RLS or soft-deleted — see the docblock. Skipped, never partially rendered.
		if (!item) continue;
		corpus.push(toFileItem(attachment, message, channel, item, ctx));
	}

	// --- The channel index ----------------------------------------------------------------------
	// Counted from the RESOLVED corpus rather than from a `count` over `message_attachments`, so the
	// figure beside a channel name can never exceed what opening that channel actually shows. It is
	// filter-independent (the fixture's contract) and bounded by the same corpus caps, which is the
	// honest reading of "how many files are in here" for a bounded window.
	const counts = new Map<string, number>();
	for (const file of corpus) counts.set(file.channelId, (counts.get(file.channelId) ?? 0) + 1);
	const channels: FileChannelRef[] = scopedChannels.map((row) => ({
		...toChannelRef(row),
		count: counts.get(row.id) ?? 0,
	}));

	// --- Filter, sort, page ---------------------------------------------------------------------
	const sort = params.sort ?? "date";
	const dir = params.dir ?? (sort === "date" ? "desc" : "asc");
	const sorted = sortItems(corpus.filter((file) => matches(file, params)), sort, dir);
	const total = sorted.length;

	const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const idx = sorted.findIndex((file) => file.id === params.cursor);
		// A cursor that no longer resolves restarts the page rather than erroring. The row it named
		// can legitimately have been deleted, or filtered out by a facet the caller changed between
		// pages, and neither is a failure the reader could act on.
		start = idx === -1 ? 0 : idx + 1;
	}
	const page = sorted.slice(start, start + limit);
	const hasMore = start + limit < total;

	return {
		scope: requestedChannelId ? "channel" : "project",
		projectId: clampOr(params.projectId, 120, project.slug),
		channelId: requestedChannelId ? clamp(requestedChannelId, 120) : null,
		items: page,
		channels,
		hasMore,
		nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
		total,
		// `max(80)` with no `min`, so an anonymous actor's `""` is a legal value and means exactly
		// what it says: nothing on this page is the viewer's own, so nothing offers inline rename.
		viewerId: clamp(actor.userId, 80),
	};
}

// #endregion
