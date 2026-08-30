import type { SupabaseClient } from "supabaseClient";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	filesDb,
	NO_PRESENCE_SIGNAL,
	partyOf,
	type PartyRow,
	senderOf,
} from "../projects/live-support.ts";
import type {
	FileChannelRef,
	FileItem,
	FileListPage,
	FileListParams,
	FileSortDir,
	FileSortKey,
	MemberRosterPage,
	ProjectMemberRow,
} from "@projective/types/projects";
import type {
	AssetOwnerType,
	AssetSource,
	AssetVisibility,
	FileCategory,
	FileKind,
	FileStatus,
	LinkAttachment,
	LinkScanStatus,
} from "@projective/types/files";
import {
	categorizeFile,
	categoryToKind,
	fileExtension,
	messageAttachmentFacets,
} from "@projective/types/files";

/**
 * live-workspace — the RLS-scoped Postgres read path for a DM thread's **Files** and **Members**
 * tabs (`/messages/[conversationId]/{files,members}`).
 *
 * Both endpoints deliberately return the SAME projections the engagement surfaces use
 * (`FileListPage` / `MemberRosterPage`, the Zod SSOT in `@projective/types/projects`), because
 * `/messages/[id]/files` mounts the very same `FileExplorer` island as
 * `/projects/[id]/[channel]/files` and the roster mounts the same `MemberRoster` (Decision #50).
 * One component tree, one behaviour — which means this module's job is not "read the DM tables" but
 * "read the DM tables and answer in the projects domain's vocabulary", and every place those two
 * disagree is recorded below rather than smoothed over.
 *
 * Every query runs under the caller's own JWT through the `commsDb`/`filesDb`/`orgDb` helpers in
 * `../projects/live-support.ts`. Nothing here uses the service-role client, and the schema profile
 * is never omitted: `supabase/config.toml` exposes `comms` and `files`, but the DEFAULT profile is
 * `public`, so a bare client 404s on the table name in a way that does not say why.
 *
 * ## Why the files read cannot use `comms.channel_files`
 *
 * `comms.channel_files` is the channel-level attachment index and carries **no `message_id`**, while
 * `FileItemSchema` re-mandates `messageId`/`messageText`/`sender`/`channelId`/`channelName`/
 * `channelKind` as non-null `min(1)` (it is `AssetItemSchema` with provenance narrowed back on). A
 * `channel_files` row can satisfy the broader `AssetItem` and can NEVER satisfy `FileItem`. So the
 * source of truth here is `comms.message_attachments` joined to `comms.dm_messages` — the only pair
 * that carries a message to point at.
 *
 * ## Two discriminator vocabularies live in one schema
 *
 * `comms.message_attachments.message_table` is CHECKed against the SCHEMA-QUALIFIED strings
 * `'comms.project_messages'` / `'comms.dm_messages'`, while `comms.channel_files.channel_type` uses
 * the BARE strings `'project'` / `'dm'` for the same concept. Matching the wrong one returns zero
 * rows rather than erroring, so the value used here is a named constant ({@link DM_MESSAGE_TABLE})
 * rather than a literal repeated at a call site.
 *
 * ## No embedding, anywhere on this path
 *
 * `comms.message_attachments` is POLYMORPHIC on `(message_table, message_id)` with **no foreign key
 * on `message_id`** — Postgres cannot point one column at two parents — so PostgREST cannot embed it
 * in either direction. `files.items` additionally lives in a different exposed schema, where
 * cross-schema embedding is broker-version dependent and would need the FK named to avoid
 * `PGRST201`. Every join below is therefore a second `.in()` query stitched in TypeScript, chunked
 * at {@link IN_CHUNK} ids per request because a `?id=in.(...)` of several hundred uuids is a
 * multi-kilobyte URL that a proxy in front of PostgREST may refuse.
 *
 * ## A DM attachment the viewer did not upload is currently unreadable
 *
 * `files.items` SELECT delegates to `files.fn_can_read(id)` (`00002011_policies_projects.sql`),
 * whose branches are: `public` visibility · own row · active member of the owning team/business/
 * organisation · `bucket_id = 'project'` gated by `projects.has_project_access`. A DM attachment
 * lands in the `messages` bucket (anchored on `{thread_id}`, `00005040`), is owned by the person who
 * sent it, and carries `link` visibility — which that predicate deliberately does NOT honour,
 * because the share slug is meant to be the credential. **There is no `messages`-bucket branch at
 * all**, so the function falls through to `false` and a co-participant reads zero `files.items` rows
 * for anything the counterparty sent.
 *
 * The join row is readable (`view_attachments_if_member` admits a DM participant), so the shape of
 * the failure is: the attachment is known to exist and its file row is withheld. Those rows are
 * OMITTED here rather than rendered from a fabricated name and size — an attachment card carrying
 * invented metadata is worse than an absent one. Nothing raises; the page just comes back thinner
 * than the conversation, which is exactly the silent-narrowing shape that policy replacement warned
 * about for the old `USING (true)`. Fixing it is a policy change (a `bucket_id = 'messages'` branch
 * keyed on `comms.dm_participants`), not something a query can work around.
 *
 * ## The unified-chatId contract still does not survive the trip to Postgres
 *
 * `FileListPage.projectId` / `MemberRosterPage.projectId` carry the CONVERSATION id here (the params
 * shape is shared across all three scopes). Live that is `comms.dm_threads.id`, a v4 uuid, where the
 * fixtures mint `dm-{handle}` on both sides so a project DM and the inbox agree. The mismatch is
 * inherited from `./live-queries.ts` and is flagged there; this module returns the same real uuid so
 * the two halves of the live path at least agree with each other.
 */

// #region Constants

/**
 * The `comms.message_attachments.message_table` discriminator for a DM.
 *
 * Schema-qualified, per that table's CHECK — see the module docblock on the two vocabularies.
 */
const DM_MESSAGE_TABLE = "comms.dm_messages";

/**
 * How far back the attachment scan reaches, in messages.
 *
 * There is no attachment index keyed on a thread — `message_attachments` names a MESSAGE, and
 * `dm_messages` is the only table that knows which thread that message belongs to — so the file list
 * is necessarily "the attachments of the newest N messages". A cap is unavoidable; stating it is the
 * honest part. PostgREST's own `max_rows = 1000` would bound it regardless, and this number is
 * visible to a reader rather than being a property of a config file three directories away.
 */
const MESSAGE_SCAN_CAP = 400;

/**
 * Ids per `.in()` request.
 *
 * PostgREST filters travel in the query string, so one `.in()` over {@link MESSAGE_SCAN_CAP} uuids
 * is a ~16 KB URL — comfortably past the default header buffer of the proxies that usually sit in
 * front of it. The failure would be a 414 on a busy conversation and a working page on a quiet one,
 * which is the worst kind of bug to have to reproduce.
 */
const IN_CHUNK = 100;

/** Page size when the caller does not ask for one. Matches the fixture pager. */
const DEFAULT_PAGE = 60;

/** Hard ceiling on a page — `FileListParamsSchema.limit` is `max(200)`. */
const MAX_PAGE = 200;

/** The `files.items` columns one asset row needs. `deleted_at` is filtered, never selected. */
const ITEM_COLUMNS = [
	"id",
	"owner_user_id",
	"owner_type",
	"owner_entity_id",
	"folder_id",
	"display_name",
	"original_name",
	"mime_type",
	"size_bytes",
	"category",
	"status",
	"source",
	"visibility",
	"share_slug",
	"download_count",
	"starred",
	"content_hash",
	"hash_sampled",
	"link_url",
	"link_domain",
	"link_title",
	"link_description",
	"link_favicon_url",
	"link_scan_status",
	"link_scanned_at",
	"external_web_url",
	"created_at",
].join(", ");

/** The `comms.dm_messages` columns the provenance stitch needs. */
const MESSAGE_COLUMNS = "id, sender_user_id, body, created_at";

/**
 * Zod `.max()` bounds this module clamps to.
 *
 * Every one of these columns is unbounded `text` in Postgres while its field is bounded and THROWS
 * rather than truncating, so one long filename or message body would fail an entire page read. The
 * numbers are restated here as named constants so a reader can check them against the schemas
 * without holding a dozen magic numbers in their head.
 */
const MAX = {
	name: 200,
	ext: 12,
	url: 2000,
	sizeLabel: 16,
	messageText: 4000,
	channelName: 160,
	dateLabel: 28,
	joinedLabel: 28,
	linkDomain: 253,
	linkTitle: 300,
	linkDescription: 600,
	linkFavicon: 600,
	shareSlug: 64,
	ownerId: 80,
} as const;

/** The title a conversation with no group name and no resolvable counterparty falls back to. */
const UNTITLED_THREAD = "Conversation";

/** The name an asset row with neither a display name nor an original name falls back to. */
const UNTITLED_ASSET = "Untitled";

// #endregion

// #region Row shapes

/** One `comms.dm_threads` row, restricted to what these two projections read. */
interface ThreadRow {
	id: string;
	kind: string;
	title: string | null;
}

/** One `comms.dm_messages` row as selected by {@link MESSAGE_COLUMNS}. */
interface MessageRow {
	id: string;
	sender_user_id: string;
	body: string;
	created_at: string;
}

/** One `comms.message_attachments` join row. */
interface AttachmentRow {
	id: string;
	message_id: string;
	attachment_id: string;
}

/** One `files.items` row as selected by {@link ITEM_COLUMNS}. */
interface ItemRow {
	id: string;
	owner_user_id: string;
	owner_type: string;
	owner_entity_id: string | null;
	folder_id: string | null;
	display_name: string | null;
	original_name: string | null;
	mime_type: string | null;
	size_bytes: number | string | null;
	category: string | null;
	status: string | null;
	source: string | null;
	visibility: string | null;
	share_slug: string | null;
	download_count: number | null;
	starred: boolean | null;
	content_hash: string | null;
	hash_sampled: boolean | null;
	link_url: string | null;
	link_domain: string | null;
	link_title: string | null;
	link_description: string | null;
	link_favicon_url: string | null;
	link_scan_status: string | null;
	link_scanned_at: string | null;
	external_web_url: string | null;
	created_at: string;
}

/**
 * One row of `comms.dm_thread_roster()` — identity only.
 *
 * Deliberately NOT the `dm_participants` row shape: the SELECT policy on that table is own-row-only
 * precisely so a co-participant's private per-viewer state (`is_muted`, `is_archived`,
 * `last_read_at`, `deleted_at`) cannot be read, and this `SECURITY DEFINER` function answers the
 * membership question with three columns, none of which is state.
 */
interface RosterRow {
	thread_id: string;
	user_id: string;
	joined_at: string;
}

// #endregion

// #region Formatting

/**
 * Every pre-formatted label below is derived in **UTC** with `getUTC*`, never `Intl` and never local
 * time.
 *
 * This is the same rule the fixtures follow, with the same reason written on them: the label is
 * produced on the server and re-rendered by the client after hydration, and any timezone-dependent
 * or locale-dependent formatting makes those two disagree on the first paint.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** A `h:mm AM` clock in UTC — `AssetItem.timeLabel` is `max(20)`. */
function clockLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	const hh = d.getUTCHours();
	const h12 = hh % 12 === 0 ? 12 : hh % 12;
	return `${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** A relative day divider in UTC — `AssetItem.dayLabel` is `max(24)`. */
function dayLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const days = Math.floor((now - at) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	const d = new Date(at);
	return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** An absolute join date in UTC ("Jul 14, 2026") — `ProjectMemberRow.joinedLabel` is `max(28)`. */
function joinedLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * A human byte size.
 *
 * Decimal (1000-based) rather than binary, and mirroring the fixture formatter character for
 * character. That agreement is the point: the same asset must not read "8.4 MB" from the database
 * and "8.0 MB" from the fixtures, because the fallback path is reached on any live failure and a
 * figure that changes on refresh looks like the data changed.
 */
function sizeLabelOf(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
	return `${bytes} B`;
}

// #endregion

// #region Column coercion

/**
 * The four `files.*` enums align member-for-member with their Zod counterparts today, so the
 * coercers below are guards against a future member reaching a client as an unparseable row rather
 * than translations. Each lands on the reading that misleads least when it cannot recognise a value.
 */

const SOURCES: ReadonlySet<string> = new Set([
	"supabase",
	"google_drive",
	"dropbox",
	"frameio",
	"s3",
	"link",
]);

const STATUSES: ReadonlySet<string> = new Set([
	"pending_upload",
	"scanning",
	"uploaded",
	"error",
	"quarantined",
]);

const VISIBILITIES: ReadonlySet<string> = new Set(["private", "link", "public"]);

const OWNER_KINDS: ReadonlySet<string> = new Set(["user", "team", "business", "organisation"]);

const SCAN_STATUSES: ReadonlySet<string> = new Set([
	"pending",
	"safe",
	"suspicious",
	"blocked",
	"unscannable",
]);

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

/** `files.file_source` → {@link AssetSource}. An unknown source is the platform's own storage. */
function toSource(raw: string | null): AssetSource {
	return (raw && SOURCES.has(raw) ? raw : "supabase") as AssetSource;
}

/**
 * `files.file_status` → {@link FileStatus}.
 *
 * An unrecognised status becomes `uploaded` rather than `error`: this row is reachable only because
 * it is already attached to a delivered message, and painting an existing attachment as failed is
 * the more alarming way to be wrong.
 */
function toStatus(raw: string | null): FileStatus {
	return (raw && STATUSES.has(raw) ? raw : "uploaded") as FileStatus;
}

/**
 * `files.file_visibility` → {@link AssetVisibility}.
 *
 * Falls back to `link`, matching `messageAttachmentFacets`: an attachment inside a thread is
 * semi-private BY CONSTRUCTION, because an attachment nobody in the conversation can open is not an
 * attachment. `private` would be the wrong floor here — it would describe a file the recipient is
 * demonstrably looking at as one only its owner may see.
 */
function toVisibility(raw: string | null): AssetVisibility {
	return (raw && VISIBILITIES.has(raw) ? raw : "link") as AssetVisibility;
}

/** `files.owner_kind` → {@link AssetOwnerType}. */
function toOwnerType(raw: string | null): AssetOwnerType {
	return (raw && OWNER_KINDS.has(raw) ? raw : "user") as AssetOwnerType;
}

/**
 * `files.link_scan_status` → {@link LinkScanStatus}.
 *
 * The column is NULL until the safety pipeline has run AT ALL, which its own migration comment notes
 * is distinct from `pending` (queued). The Zod enum has no member for "never queued", so a NULL is
 * reported as `pending` — the conservative direction, since it declines to assert that an unscanned
 * link is safe.
 */
function toScanStatus(raw: string | null): LinkScanStatus {
	return (raw && SCAN_STATUSES.has(raw) ? raw : "pending") as LinkScanStatus;
}

/**
 * The asset's rich {@link FileCategory}.
 *
 * `files.items.category` is `NOT NULL DEFAULT 'Other'`, so `Other` means BOTH "genuinely
 * uncategorisable" and "nobody has classified this row yet" — the two are indistinguishable in the
 * column. Re-deriving from the name and MIME type in that case costs nothing and recovers the
 * classification for every row written before the upload path started setting it; a stored value
 * that is anything else is trusted, because it is the authoritative facet the hub filters on.
 */
function categoryOf(row: ItemRow, name: string): FileCategory {
	const stored = row.category;
	if (stored && stored !== "Other" && CATEGORIES.has(stored)) return stored as FileCategory;
	return categorizeFile(name, row.mime_type ?? undefined);
}

/**
 * `files.items.size_bytes` is `bigint`, which PostgREST may serialise as a JSON string once it
 * exceeds the safe-integer range. `AssetItem.sizeBytes` is `int().min(0)`, so a `NaN` or a fraction
 * fails the parse; anything unreadable is reported as 0 bytes, which renders as "0 B" rather than
 * taking the page down.
 */
function sizeOf(raw: number | string | null): number {
	const n = typeof raw === "string" ? Number(raw) : raw ?? 0;
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// #endregion

// #region Asset mapping

/**
 * The URL an asset resolves to.
 *
 * A `link` asset carries its own target and a mounted connector asset carries the provider's
 * "open in Drive/Dropbox" page, both of which are real, durable URLs. A **stored** asset has
 * neither: `files.items` holds `bucket_id` + `storage_path`, and the `messages` bucket is a PRIVATE
 * tier whose objects are readable only through a short-lived signed URL. Minting one is a storage
 * round trip PER OBJECT with an expiry that server-rendered HTML would outlive, so it belongs to a
 * download route rather than a list read.
 *
 * `"#"` is the sentinel `AssetItemSchema` already documents for a non-previewable asset, so the grid
 * draws the category glyph — the same thing it draws for a fixture stub. Emitting a guessed
 * `/storage/v1/object/...` path instead would render as a broken image or a 400 on every row, which
 * is the failure mode `partyOf`'s null avatar exists to avoid.
 */
function urlOf(row: ItemRow, source: AssetSource): string {
	if (source === "link" && row.link_url) return clamp(row.link_url, MAX.url);
	if (source !== "supabase" && row.external_web_url) {
		return clamp(row.external_web_url, MAX.url);
	}
	return "#";
}

/**
 * The `link` facet of a link asset, or `null`.
 *
 * `LinkAttachmentSchema.domain` is `min(1)` while `files.items.link_domain` is nullable, so the host
 * is recovered from the URL when the column is empty — a link card whose subtitle is blank has lost
 * the one fact identifying where it points. `URL` parsing is guarded because `link_url` is free text
 * with only a NOT NULL CHECK behind it, not a validated URL.
 */
function linkOf(row: ItemRow, source: AssetSource): LinkAttachment | null {
	if (source !== "link" || !row.link_url) return null;
	const url = clamp(row.link_url, MAX.url);
	let host = row.link_domain?.trim() ?? "";
	if (!host) {
		try {
			host = new URL(url).hostname;
		} catch {
			host = "";
		}
	}
	return {
		url,
		domain: clampOr(host, MAX.linkDomain, "link"),
		title: clamp(row.link_title, MAX.linkTitle),
		description: row.link_description ? clamp(row.link_description, MAX.linkDescription) : null,
		faviconUrl: row.link_favicon_url ? clamp(row.link_favicon_url, MAX.linkFavicon) : null,
		scanStatus: toScanStatus(row.link_scan_status),
		scannedAt: row.link_scanned_at,
	};
}

/** The per-file provenance a {@link FileItem} needs that the asset row does not carry. */
interface FileContext {
	/** The thread the attachment was posted in — `FileItem.channelId`. */
	threadId: string;
	/** The thread's display name — `FileItem.channelName`, which is `min(1)`. */
	threadName: string;
	/** The message the attachment hangs off. */
	message: MessageRow;
	/** Display parties by user id, for the sender. */
	parties: Map<string, PartyRow>;
	/** The acting viewer's user id — gates `canManage` and the star. */
	viewerId: string;
	/** Wall clock for the pre-formatted labels. */
	now: number;
}

/**
 * Map one `files.items` row plus its message onto the explorer's {@link FileItem} projection.
 *
 * Several required fields have no live source and are returned NEUTRAL rather than synthesised.
 * Each looks like an omission, so each is stated:
 *
 * - `width` / `height` / `durationLabel` — nothing on `files.items` records intrinsic pixel
 *   dimensions or media duration, and no writer in this repo puts them in `metadata` either. `null`
 *   lets the preview size itself from the object it actually loads; a guessed aspect ratio would
 *   make every image jump on decode.
 * - `thumbnailUrl` — a thumbnail is a URL, and stored assets have none (see {@link urlOf}). There is
 *   no derived-thumbnail column and no rendition pipeline, so this is `null` for every row.
 * - `messageAudioUrl` — there is no audio URL and no waveform column anywhere in `comms`;
 *   `dm_messages.is_audio` is a denormalised boolean **no trigger maintains** and is not treated as
 *   truth. A voice note reaches this list as an ordinary `audio`-kind attachment row, which is what
 *   it physically is, rather than as the separate synthetic row the fixtures derive from their
 *   `ChatMessage.audio` object.
 * - `external` — populating `ExternalRefSchema` needs `providerSlug`, which lives in
 *   `integrations.providers`, and `supabase/config.toml` does **not expose the `integrations`
 *   schema** to PostgREST. A mounted asset therefore cannot carry its connector back-reference; its
 *   provider URL still survives as {@link urlOf}'s answer.
 * - `folderPath` — the trail lives on `files.folders.path` and would be a third keyed query for a
 *   breadcrumb nothing renders in a conversation. Left empty by the shared helper's default.
 * - `downloadedByViewer` — `files.download_events` is read-own and could answer this, but it is a
 *   per-page query for a per-DEVICE fact, and `false` is the safe reading: it prompts on a repeat
 *   download rather than silently skipping the prompt.
 *
 * `starred` is the OWNER's shelf mark (`files.items.starred`, whose own migration comment flags that
 * it is deliberately NOT per-viewer), so it is reported only to the owner. Showing a counterparty
 * their sender's star — and letting them toggle it — would be a per-viewer control wired to somebody
 * else's state.
 */
function toFileItem(row: ItemRow, attachmentId: string, ctx: FileContext): FileItem {
	const name = clampOr(row.display_name ?? row.original_name, MAX.name, UNTITLED_ASSET);
	const source = toSource(row.source);
	const category = categoryOf(row, row.original_name ?? name);
	// A link has no category that maps to `link` — the DB taxonomy has no such member — so the
	// rendering bucket is overridden from the source, which is the only column that knows.
	const kind: FileKind = source === "link" ? "link" : categoryToKind(category);
	const bytes = source === "link" ? 0 : sizeOf(row.size_bytes);
	const ownerType = toOwnerType(row.owner_type);
	const ownerId = ownerType === "user"
		? row.owner_user_id
		: row.owner_entity_id ?? row.owner_user_id;
	const isOwner = row.owner_user_id === ctx.viewerId;

	// The MESSAGE's instant, not the file's or the join row's. `files.items.created_at` is when the
	// bytes were uploaded and `message_attachments.created_at` is when the link was written; the
	// explorer's "date" means when this was SHARED, and pinning it to the message is what keeps a file
	// row and the message it points at telling the same story — the invariant the fixtures state.
	const at = ctx.message.created_at;
	const time = clockLabel(at);
	const day = dayLabel(at, ctx.now);

	return {
		// The JOIN row's id, not the asset's: one file may be attached to two messages, and those are
		// two rows in this list with two different provenances. The asset id would collide between
		// them, which would break the grid key, the cursor and the preview-modal selector at once.
		id: attachmentId,
		kind,
		category,
		name,
		ext: clamp(fileExtension(row.original_name ?? name), MAX.ext),
		url: urlOf(row, source),
		thumbnailUrl: null,
		sizeBytes: bytes,
		sizeLabel: clamp(sizeLabelOf(bytes), MAX.sizeLabel),
		width: null,
		height: null,
		durationLabel: null,

		channelId: ctx.threadId,
		channelName: ctx.threadName,
		// A DM is not a `general` channel. The fixtures say `general` here (and `general` again in the
		// roster's `channelKind`), which is a fixture artefact rather than a fact — `ChannelKind` has a
		// `dm` member and this is a DM. Flagged rather than propagated: the roster below DOES keep
		// `general`, because `MemberRosterPage` pins fields the roster island branches on and the live
		// path must not differ from the fixture the service falls back to. See its docblock.
		channelKind: "dm",
		messageId: ctx.message.id,
		messageText: clamp(ctx.message.body, MAX.messageText),
		messageAudioUrl: null,
		sender: senderOf(ctx.message.sender_user_id, ctx.parties.get(ctx.message.sender_user_id)),

		createdAt: at,
		timeLabel: time,
		dayLabel: day,
		dateLabel: clamp(`${day} · ${time}`, MAX.dateLabel),
		starred: isOwner ? row.starred === true : false,

		// The shared helper supplies the defaults a message attachment carries BY CONSTRUCTION, so the
		// live path and the fixture path tell one story about them; the real columns then override the
		// ones the database actually knows. Spreading first is deliberate — a field the helper gains
		// later arrives here for free, and a field this row genuinely answers always wins.
		...messageAttachmentFacets(clamp(ownerId, MAX.ownerId), {
			visibility: toVisibility(row.visibility),
			canManage: isOwner,
			shareSlug: row.share_slug ? clamp(row.share_slug, MAX.shareSlug) : null,
			downloadCount: Math.max(0, Math.floor(row.download_count ?? 0)),
		}),
		source,
		status: toStatus(row.status),
		ownerType,
		folderId: row.folder_id,
		contentHash: row.content_hash,
		hashSampled: row.hash_sampled === true,
		link: linkOf(row, source),
	};
}

// #endregion

// #region Shared plumbing

/** Split a list into `.in()`-sized batches. See {@link IN_CHUNK} for why this is not one request. */
function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		out.push(items.slice(index, index + size));
	}
	return out;
}

/**
 * Whether the viewer is an undeleted participant of this thread, and the thread row itself.
 *
 * Returns `null` for "no such conversation, as far as this caller is concerned" — which deliberately
 * collapses three cases the caller cannot tell apart anyway: the thread does not exist, the viewer
 * was never in it, or the viewer soft-deleted it for themselves. Distinguishing them in the response
 * would confirm the existence of a thread to somebody who is not in it.
 *
 * `deleted_at IS NULL` matches the inbox's own filter in `./live-queries.ts`: deleting a conversation
 * for yourself removes it from your inbox, so its Files and Members tabs must not remain reachable
 * behind it.
 *
 * Both reads THROW on a query failure. This is the primary gate for both endpoints — a broker error
 * here is not "no such conversation", and answering `null` would render a 404 for a thread that
 * exists.
 */
async function resolveThread(
	db: SupabaseClient,
	actor: ReadActor & { accessToken: string },
	threadId: string,
): Promise<ThreadRow | null> {
	const membership = await db
		.from("dm_participants")
		.select("thread_id")
		.eq("thread_id", threadId)
		.eq("user_id", actor.userId)
		.is("deleted_at", null)
		.maybeSingle();

	if (membership.error) {
		throw new Error(`comms.dm_participants read failed: ${membership.error.message}`);
	}
	if (!membership.data) return null;

	const thread = await db
		.from("dm_threads")
		.select("id, kind, title")
		.eq("id", threadId)
		.maybeSingle();

	if (thread.error) throw new Error(`comms.dm_threads read failed: ${thread.error.message}`);
	if (!thread.data) return null;
	return thread.data as unknown as ThreadRow;
}

/**
 * The thread's identity-only roster, through the `SECURITY DEFINER` `comms.dm_thread_roster(uuid[])`.
 *
 * Read through the function and never through the table: the SELECT policy on
 * `comms.dm_participants` is own-row-only, so a direct read returns exactly one row — the caller's —
 * and would silently report every conversation as having a single member. RLS is row-level, so
 * admitting a co-participant's row would admit every private column on it; the function is the narrow
 * answer.
 *
 * `throwOnError` is a parameter because the same read is primary for one endpoint and secondary for
 * the other: the roster IS the members projection, but the files projection only borrows a name from
 * it. See each caller.
 */
async function fetchRoster(
	db: SupabaseClient,
	threadId: string,
	throwOnError: boolean,
): Promise<RosterRow[]> {
	const { data, error } = await db.rpc("dm_thread_roster", { p_thread_ids: [threadId] });
	if (error) {
		if (throwOnError) throw new Error(`comms.dm_thread_roster failed: ${error.message}`);
		return [];
	}
	return ((data ?? []) as RosterRow[]).filter((row) => row.thread_id === threadId);
}

/**
 * The name a conversation goes by.
 *
 * A GROUP carries its own `title`. A DM's `title` is NULL by design — the column's own comment says
 * storing a copy of the counterparty's name there would go stale the moment they renamed themselves
 * — so the counterparty's live name is the title. `channelName` and `projectTitle` are both `min(1)`,
 * so the absence has to be spelled: a thread whose roster could not be read, or whose only other
 * member's public profile row is withheld by RLS, falls back to {@link UNTITLED_THREAD} rather than
 * to an empty string the schema cannot carry.
 */
function threadTitle(
	thread: ThreadRow,
	roster: readonly RosterRow[],
	parties: Map<string, PartyRow>,
	viewerId: string,
): string {
	const explicit = clamp(thread.title, MAX.channelName).trim();
	if (explicit) return explicit;
	const other = roster.find((row) => row.user_id !== viewerId);
	const name = other ? partyOf(parties.get(other.user_id)).name : "";
	return clampOr(name, MAX.channelName, UNTITLED_THREAD);
}

// #endregion

// #region Files

/**
 * Order rows by the requested key, mirroring the projects explorer and the fixture pager exactly.
 *
 * The comparators live here rather than in `ORDER BY` because the list is assembled in TypeScript
 * from three tables anyway: `sender` sorts on a name resolved from `org.users_public`, `type` on a
 * kind derived from the filename, and `size` on a column that may arrive as a string. Pushing any of
 * them into SQL would be a second implementation of a rule already written down once.
 */
function sortFiles(rows: FileItem[], key: FileSortKey, dir: FileSortDir): FileItem[] {
	const sign = dir === "asc" ? 1 : -1;
	const cmp: Record<FileSortKey, (a: FileItem, b: FileItem) => number> = {
		name: (a, b) => a.name.localeCompare(b.name),
		date: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
		size: (a, b) => a.sizeBytes - b.sizeBytes,
		sender: (a, b) => a.sender.name.localeCompare(b.sender.name),
		type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
	};
	return [...rows].sort((a, b) => sign * cmp[key](a, b));
}

/**
 * A page of a DM thread's shared attachments, or `null` when the conversation does not exist or the
 * viewer is not in it.
 *
 * `params.projectId` carries the conversation id (the params shape is shared across all three
 * scopes) and `params.channelId`, when present, carries it too — the same precedence the fixture
 * pager uses, so the island's existing call sites need no change. `now` defaults to the wall clock
 * and is a parameter only so the caller can pass the same reference instant it uses elsewhere in one
 * request; the labels it feeds are relative ("Today"), so two different clocks in one response would
 * be visible.
 *
 * ## The read, and why it is four queries
 *
 * 1. membership + the thread row ({@link resolveThread}) — the gate, and the only source of a title;
 * 2. the newest {@link MESSAGE_SCAN_CAP} messages, which is the only way to name this thread's
 *    attachments (`message_attachments` knows a message id, not a thread id);
 * 3. the join rows for those message ids, keyed on the schema-qualified {@link DM_MESSAGE_TABLE};
 * 4. the `files.items` rows for the asset ids that produced.
 *
 * Steps 3 and 4 are chunked (see {@link IN_CHUNK}). Nothing is embedded — see the module docblock.
 *
 * ## Failure behaviour
 *
 * Steps 1, 2 and 3 THROW with the table named, because each is load-bearing: without them the page
 * would be reported as empty, and an empty attachment list is indistinguishable from a conversation
 * that never shared anything. Step 4 does NOT throw — a chunk that fails costs its own rows, and the
 * rest of the page still resolves. The party lookup and the roster are secondary throughout and
 * degrade to "Unknown" and {@link UNTITLED_THREAD}, exactly as `../projects/live-queries.ts` does.
 *
 * An attachment whose `files.items` row is missing — deleted, or withheld by the `messages`-bucket
 * gap in `files.fn_can_read` described in the module docblock — is DROPPED rather than rendered from
 * invented metadata. `total` and the channel `count` therefore describe what the viewer can actually
 * read, not what the thread contains.
 */
export async function fetchConversationFilePage(
	actor: ReadActor & { accessToken: string },
	params: FileListParams,
	now: number = Date.now(),
): Promise<FileListPage | null> {
	const threadId = params.channelId || params.projectId;
	const db = commsDb(actor);

	const thread = await resolveThread(db, actor, threadId);
	if (!thread) return null;

	const messagesRes = await db
		.from("dm_messages")
		.select(MESSAGE_COLUMNS)
		.eq("thread_id", threadId)
		// Nothing in this schema hides soft-deleted rows for you — no view, no partial index — so a
		// missing filter here silently resurrects a deleted message's attachments into the explorer.
		.is("deleted_at", null)
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(MESSAGE_SCAN_CAP);

	if (messagesRes.error) {
		throw new Error(`comms.dm_messages read failed: ${messagesRes.error.message}`);
	}
	const messages = (messagesRes.data ?? []) as unknown as MessageRow[];

	const attachments = messages.length > 0
		? await fetchAttachmentRows(db, messages.map((row) => row.id))
		: [];

	const items = attachments.length > 0
		? await fetchItemRows(actor, attachments.map((row) => row.attachment_id))
		: new Map<string, ItemRow>();

	// The roster is borrowed only for a DM's title, so it degrades rather than throwing; the party
	// lookup covers both the roster's counterparty and every message sender in one request.
	const roster = await fetchRoster(db, threadId, false);
	const parties = await fetchParties(actor, [
		...roster.map((row) => row.user_id),
		...messages.map((row) => row.sender_user_id),
	]);
	const threadName = threadTitle(thread, roster, parties, actor.userId);

	const byMessage = new Map(messages.map((row) => [row.id, row]));
	const all: FileItem[] = [];
	for (const link of attachments) {
		const item = items.get(link.attachment_id);
		const message = byMessage.get(link.message_id);
		// A join row whose asset or message did not come back is skipped, never faked. See the
		// docblock: the common cause is the `messages`-bucket hole in `files.fn_can_read`.
		if (!item || !message) continue;
		all.push(
			toFileItem(item, link.id, {
				threadId,
				threadName,
				message,
				parties,
				viewerId: actor.userId,
				now,
			}),
		);
	}

	const kinds = params.kinds && params.kinds.length > 0 ? new Set<string>(params.kinds) : null;
	const query = params.query?.trim().toLowerCase();
	const matched = all.filter((file) =>
		(!kinds || kinds.has(file.kind)) &&
		(!query ||
			file.name.toLowerCase().includes(query) ||
			file.sender.name.toLowerCase().includes(query))
	);

	const sorted = sortFiles(matched, params.sort ?? "date", params.dir ?? "desc");
	const limit = Math.min(MAX_PAGE, Math.max(1, params.limit ?? DEFAULT_PAGE));
	// A cursor naming a row that is no longer in the result — filtered out, or deleted since —
	// resolves to the start of the list rather than erroring, matching the fixture pager's fail-open
	// so the two halves behave identically instead of one repeating where the other 500s.
	const found = params.cursor ? sorted.findIndex((file) => file.id === params.cursor) : -1;
	const start = found >= 0 ? found + 1 : 0;
	const page = sorted.slice(start, start + limit);
	const hasMore = start + limit < sorted.length;

	// One channel, because a conversation IS the channel. `count` is the whole readable thread,
	// independent of the active filter — it drives the tree's secondary figure, not the page caption.
	const channel: FileChannelRef = {
		id: threadId,
		name: threadName,
		kind: "dm",
		count: all.length,
	};

	return {
		scope: "conversation",
		projectId: threadId,
		channelId: threadId,
		items: page,
		channels: [channel],
		hasMore,
		nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
		total: sorted.length,
		viewerId: actor.userId,
	};
}

/**
 * The `comms.message_attachments` join rows for a set of DM message ids.
 *
 * THROWS on failure: this is the list itself, and an empty result would be rendered as "no shared
 * files" for a conversation full of them.
 */
async function fetchAttachmentRows(
	db: SupabaseClient,
	messageIds: readonly string[],
): Promise<AttachmentRow[]> {
	const rows: AttachmentRow[] = [];
	for (const batch of chunk(messageIds, IN_CHUNK)) {
		const { data, error } = await db
			.from("message_attachments")
			.select("id, message_id, attachment_id")
			// The schema-qualified discriminator — `channel_files` uses the bare `'dm'` for the same
			// concept, and the wrong one returns zero rows without erroring.
			.eq("message_table", DM_MESSAGE_TABLE)
			.in("message_id", batch as string[]);
		if (error) {
			throw new Error(`comms.message_attachments read failed: ${error.message}`);
		}
		rows.push(...((data ?? []) as unknown as AttachmentRow[]));
	}
	return rows;
}

/**
 * The `files.items` rows behind a set of attachment ids, keyed by id.
 *
 * Does NOT throw. A chunk that fails costs only its own rows — every other attachment on the page
 * still resolves — and the rows it would have carried are dropped by the same path that drops a row
 * RLS withheld. Throwing here would turn one unreadable asset into an unreadable page, on a surface
 * where partial readability is already the normal state (see the `fn_can_read` note in the module
 * docblock).
 */
async function fetchItemRows(
	actor: ReadActor & { accessToken: string },
	attachmentIds: readonly string[],
): Promise<Map<string, ItemRow>> {
	const out = new Map<string, ItemRow>();
	const db = filesDb(actor);
	for (const batch of chunk([...new Set(attachmentIds)], IN_CHUNK)) {
		const { data, error } = await db
			.from("items")
			.select(ITEM_COLUMNS)
			.in("id", batch as string[])
			.is("deleted_at", null);
		if (error) continue;
		for (const row of (data ?? []) as unknown as ItemRow[]) out.set(row.id, row);
	}
	return out;
}

// #endregion

// #region Members

/**
 * The conversation's participant roster, or `null` when the conversation does not exist or the viewer
 * is not in it.
 *
 * ## What this projection has to pin, and why it is not drift
 *
 * `MemberRosterPage` is the ENGAGEMENT roster's shape, and three of its required fields are
 * structurally meaningless for a DM. They are pinned to the values the fixtures already use, so the
 * live path and the fallback path render identically:
 *
 * - `format: "one_off"` — `ProjectFormat` has no member meaning "not a project". A conversation is
 *   not a pipeline and has no sessions, and `one_off` is the format whose stage columns the roster
 *   island then declines to draw.
 * - `channelKind: "general"` — matched to the fixtures deliberately, even though the files projection
 *   above reports `"dm"` for the same thread. The two answer different questions (this one gates
 *   roster columns; `FileItem.channelKind` labels a file's provenance), and quietly changing this one
 *   would make the live roster differ from the fixture the service serves on any failure — a
 *   difference that would only ever be noticed as a layout changing on refresh. The inconsistency is
 *   the fixtures'; it is recorded rather than half-fixed.
 * - `viewerRole` / `viewerCaps` — a conversation has no management surface. There are no roles to
 *   change, no stages to assign and nobody to revoke; the only membership action is ADDING people,
 *   which runs through the contact picker rather than an email invitation queue. So every capability
 *   is `false` and the roster renders its read-only presentation.
 *
 * `invites` and `stages` come back empty for the same reason: neither has a table on this path.
 *
 * ## Fields with no column
 *
 * - `role` — `comms.dm_participants` has no role column at all. Everyone is `member`, the
 *   least-privileged member of `MemberRole`: a role we cannot read must never be promoted into an
 *   authority tier by accident. `dm_threads.created_by_user_id` is deliberately NOT read as "owner" —
 *   whoever opened a DM holds no authority in it, and a badge saying otherwise would invent a
 *   hierarchy the product does not have.
 * - `email` — `org.users_public` carries none, and an address is not something a co-participant is
 *   entitled to. `max(160)` permits the empty string, so the absence is representable.
 * - `presence` — {@link NO_PRESENCE_SIGNAL}, for EVERY row including the viewer's own. The viewer is
 *   trivially present, but marking only them online produces a roster where presence appears to work
 *   and is wrong about everybody else — worse than a uniform, honest absence.
 * - `assignment` / `assignedStages` / `openTickets` — a conversation has no stages and no tickets.
 *   `ticketsLabel` is the em-dash the fixtures use, so the column reads as "not applicable" rather
 *   than as a zero somebody might act on.
 *
 * ## Failure behaviour
 *
 * The roster RPC THROWS here, unlike in the files path: it is not a name lookup on this endpoint, it
 * IS the endpoint. Degrading would return a roster containing only the viewer — a plausible,
 * completely wrong answer no reader could tell from a genuinely solo thread. The party lookup stays
 * secondary and degrades to `"Unknown"`.
 */
export async function fetchConversationRoster(
	actor: ReadActor & { accessToken: string },
	conversationId: string,
): Promise<MemberRosterPage | null> {
	const db = commsDb(actor);

	const thread = await resolveThread(db, actor, conversationId);
	if (!thread) return null;

	const roster = await fetchRoster(db, conversationId, true);
	const parties = await fetchParties(actor, roster.map((row) => row.user_id));
	const title = threadTitle(thread, roster, parties, actor.userId);

	const members: ProjectMemberRow[] = roster
		// Join order, oldest first — the order a conversation actually grew — with the user id as a
		// deterministic tie-break, because `joined_at` defaults to `now()` and everyone added in one
		// transaction shares an instant. Without the tie-break their order would be whatever the
		// planner happened to return, which can differ between SSR and a client refetch.
		.slice()
		.sort((a, b) =>
			Date.parse(a.joined_at) - Date.parse(b.joined_at) || a.user_id.localeCompare(b.user_id)
		)
		.map((row): ProjectMemberRow => ({
			id: row.user_id,
			party: partyOf(parties.get(row.user_id)),
			email: "",
			role: "member",
			assignment: null,
			presence: NO_PRESENCE_SIGNAL,
			assignedStages: [],
			openTickets: 0,
			ticketsLabel: "—",
			joinedAt: row.joined_at,
			joinedLabel: clamp(joinedLabel(row.joined_at), MAX.joinedLabel),
			isViewer: row.user_id === actor.userId,
		}));

	// The viewer leads, as they do in the fixture roster — but as their REAL row, resolved from
	// `org.users_public`, rather than as a synthetic "You". The RPC already returns them, so
	// prepending a second row would show the viewer twice.
	const viewerIndex = members.findIndex((member) => member.isViewer);
	if (viewerIndex > 0) members.unshift(...members.splice(viewerIndex, 1));

	return {
		scope: "conversation",
		projectId: conversationId,
		channelId: conversationId,
		channelName: title,
		channelKind: "general",
		projectTitle: title,
		format: "one_off",
		members,
		invites: [],
		stages: [],
		viewerId: actor.userId,
		viewerRole: "member",
		viewerCaps: {
			canManage: false,
			canInvite: false,
			canAssign: false,
			canEditRoles: false,
			canRemove: false,
		},
		total: members.length,
	};
}

// #endregion
