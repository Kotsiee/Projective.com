import type { SupabaseClient } from "supabaseClient";
import type { ReadActor } from "../read-actor.ts";
import {
	byNewest,
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	filesDb,
	orgDb,
	type PartyRow,
	projectsDb,
	senderOf,
	toStageProjectStatus,
	toSubmissionStatus,
} from "./live-support.ts";
import {
	AssetOwnerType,
	AssetSource,
	AssetVisibility,
	CATEGORY_META,
	categoryToKind,
	fileExtension,
	FileStatus,
	LinkScanStatus,
} from "@projective/types/files";
import type { FileCategory } from "@projective/types/files";
import type {
	ChannelKind,
	FileItem,
	FileSortDir,
	FileSortKey,
	MessageSender,
	ProjectFormat,
	SubmissionCrumb,
	SubmissionListPage,
	SubmissionListParams,
	SubmissionNodeKind,
	SubmissionNote,
	SubmissionReview,
	SubmissionStatus,
	SubmissionTreeNode,
	SubmissionUnit,
	SubmissionUnitKind,
} from "@projective/types/projects";

/**
 * live-submissions — the RLS-scoped Postgres read path for the Submissions explorer
 * (`/projects/[projectId]/submissions/…` and `/projects/[projectId]/[channelId]/submissions/…`).
 *
 * It is the SQL half of `ProjectBackendService.submissions`: it narrows `projects.stage_submissions`
 * and their `files.items` to the rows the caller may see, assembles the navigation tree, and maps the
 * result onto the `SubmissionListPage` projection. Filtering, sorting and cursor paging over the
 * resolved node's files stay in TypeScript — the scoped set is the recursive subtree of a tree node
 * that only exists in memory, so there is no `WHERE` clause that could express it.
 *
 * ## The isolation rule, and why the request may only ever TIGHTEN it
 *
 * `SubmissionListParams.asFreelancer` is documented as a viewer-perspective override, and the
 * fixtures honour it in BOTH directions — `false` widens the tree to every submitter. That is safe in
 * a fixture corpus for a structural reason worth stating: the fixtures never BUILD another
 * submitter's units, so there is nothing in memory to widen INTO. A live read inverts that property.
 * The RLS policy `"View submissions"` grants any `projects.has_project_access` participant SELECT on
 * every submission in the project, so a hired freelancer can legitimately read a peer's deliverables
 * and RLS is NOT the gate here — this module is.
 *
 * So the param is honoured only where it cannot widen anything: a viewer who is already the
 * client/reviewer may ask to be isolated, and a viewer who is not is ALWAYS isolated, whatever the
 * request says. See {@link resolveIsolation}. The narrowing is a `.eq("submitted_by", …)` on the
 * submissions query itself, never a prune afterwards, so a peer's row is never fetched, never held in
 * memory, and never available to a later bug to leak.
 *
 * ## The hierarchy this schema can actually express
 *
 * `stage → submitter → unit`, and no deeper. There is no `dir` level on the live path, because
 * `projects.submission_files` is a flat `(submission_id, file_id)` pivot — nothing persists a
 * directory structure inside a submission. The one adjacent hierarchy that does exist,
 * `files.items.folder_id` → `files.folders`, is the SUBMITTER's own private library organisation;
 * rendering it here would both invent a structure the submission does not have and disclose how a
 * freelancer files their personal work inside the client's review tree. `folderPath` is `[]` for the
 * same reason. A path is therefore at most three segments deep, well inside the schema's `max(12)`.
 *
 * ## A submission is not a message, and `FileItemSchema` insists that it is
 *
 * `FileItem` re-mandates message provenance — `channelId`, `channelName`, `channelKind`, `messageId`,
 * `messageText`, `sender`, all `min(1)` — because it was written for a channel attachment. A
 * deliverable was submitted, not posted, so those fields are SYNTHESISED from the thing that actually
 * groups it (see {@link toFileItem}): the submission's own id is the `messageId`, which is exactly
 * right for the field's documented purpose (siblings sharing it form the preview modal's carousel
 * group — and a submission's files are precisely that group), and the stage's chat channel supplies
 * the channel triple, falling back to the stage's own identity when the channel row is withheld or
 * absent.
 *
 * ## PostgREST facts this code depends on
 *
 * - **The schema profile is mandatory.** Every client comes from `live-support.ts`; a bare
 *   `getUserClient` would resolve against `public` and 404 on the table name.
 * - **No cross-schema embedding.** `files.items`, `org.users_public`, `comms.project_channels` and
 *   `org.business_members` are four separate keyed reads stitched in TypeScript.
 * - **`.in()` lists are chunked** ({@link ID_CHUNK}). A submission set can reference more file ids
 *   than fit in one request URL, and the failure mode of an over-long URL is a 414 rather than a
 *   partial result.
 * - **`max_rows = 1000`.** {@link FILE_ROW_CAP} states the ceiling in this file rather than leaving it
 *   as a property of a config file three directories away.
 *
 * ## A caller-side hazard this module cannot defend against
 *
 * `SubmissionListParams.kinds` is `max(8)` while `FileKind` has NINE members, so passing the full kind
 * list through — which succeeds against the `/files` read, whose own params are `max(9)` — fails Zod
 * validation here before this function is ever reached.
 */

// #region Constants

/**
 * A ceiling on submissions pulled for one page.
 *
 * The tree is UNPAGED — `SubmissionListPage.tree` carries every node and the client navigates it in
 * memory — so the cursor on `items` bounds the FILES and nothing bounds the submissions. A long-lived
 * pipeline with thousands of deliverables would otherwise serialise its whole ledger into every
 * request, including the ones that only wanted one node's files.
 */
const SUBMISSION_ROW_CAP = 400;

/** A ceiling on file rows. PostgREST's `max_rows = 1000` caps it anyway; stating it beats knowing it. */
const FILE_ROW_CAP = 1000;

/** How many ids go into one `.in()` list. Keeps the request URL well inside every broker's limit. */
const ID_CHUNK = 150;

/** The page size when the caller does not ask for one. Matches the fixture read. */
const DEFAULT_LIMIT = 60;

/** The `projects.projects` columns this read needs. */
const PROJECT_COLUMNS = "id, slug, title, format, owner_user_id, client_business_id";

/** The `projects.project_stages` columns the tree roots and the review projection need. */
const STAGE_COLUMNS = "id, name, status, sort_order, description_text";

/** The `projects.stage_submissions` columns one unit needs. */
const SUBMISSION_COLUMNS = [
	"id",
	"project_stage_id",
	"ticket_id",
	"submitted_by",
	"title",
	"status",
	"notes",
	"created_at",
	"updated_at",
	"reviewed_by",
	"reviewed_at",
	"feedback",
].join(", ");

/** The `files.items` columns one {@link FileItem} needs. */
const FILE_COLUMNS = [
	"id",
	"owner_user_id",
	"folder_id",
	"display_name",
	"original_name",
	"size_bytes",
	"category",
	"status",
	"starred",
	"source",
	"visibility",
	"owner_type",
	"owner_entity_id",
	"content_hash",
	"hash_sampled",
	"link_url",
	"link_domain",
	"link_title",
	"link_description",
	"link_favicon_url",
	"link_scan_status",
	"link_scanned_at",
	"share_slug",
	"download_count",
	"created_at",
	"deleted_at",
].join(", ");

/**
 * The `stage_assignments.status` values that mean somebody is NOT staffed on the stage.
 *
 * The column is free text with no CHECK, so this is a deny-list over an open vocabulary rather than a
 * closed enum: an unrecognised value counts as staffed, because over-counting providers only keeps
 * the submitter level visible where it could have been collapsed, while under-counting would collapse
 * a genuinely shared stage and hide whose work is whose. `released` is deliberately absent — it is
 * ambiguous between "released from the assignment" and "escrow released", and only one of those means
 * the person left.
 */
const INACTIVE_ASSIGNMENT: ReadonlySet<string> = new Set(["cancelled", "declined"]);

/** Guard sets built from the Zod enums themselves, so the vocabulary is never restated here. */
const SOURCES: ReadonlySet<string> = new Set(AssetSource.options);
const VISIBILITIES: ReadonlySet<string> = new Set(AssetVisibility.options);
const STATUSES: ReadonlySet<string> = new Set(FileStatus.options);
const OWNER_TYPES: ReadonlySet<string> = new Set(AssetOwnerType.options);
const SCAN_STATUSES: ReadonlySet<string> = new Set(LinkScanStatus.options);

/** The `project_format` enum, which agrees with the Zod `ProjectFormat` member-for-member. */
const FORMATS: ReadonlySet<string> = new Set(["one_off", "pipeline", "session"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// #endregion

// #region Row shapes

/** One `projects.projects` row as selected by {@link PROJECT_COLUMNS}. */
interface ProjectRow {
	id: string;
	slug: string;
	title: string;
	format: string;
	owner_user_id: string;
	client_business_id: string | null;
}

/** One `projects.project_stages` row as selected by {@link STAGE_COLUMNS}. */
interface StageRow {
	id: string;
	name: string;
	status: string | null;
	sort_order: number | null;
	description_text: string | null;
}

/** One `projects.stage_submissions` row as selected by {@link SUBMISSION_COLUMNS}. */
interface SubmissionRow {
	id: string;
	project_stage_id: string;
	ticket_id: string | null;
	submitted_by: string;
	title: string | null;
	status: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	feedback: Record<string, unknown> | null;
}

/** One `files.items` row as selected by {@link FILE_COLUMNS}. */
interface FileRow {
	id: string;
	owner_user_id: string;
	folder_id: string | null;
	display_name: string | null;
	original_name: string | null;
	size_bytes: number | string | null;
	category: string | null;
	status: string | null;
	starred: boolean | null;
	source: string | null;
	visibility: string | null;
	owner_type: string | null;
	owner_entity_id: string | null;
	content_hash: string | null;
	hash_sampled: boolean | null;
	link_url: string | null;
	link_domain: string | null;
	link_title: string | null;
	link_description: string | null;
	link_favicon_url: string | null;
	link_scan_status: string | null;
	link_scanned_at: string | null;
	share_slug: string | null;
	download_count: number | null;
	created_at: string;
	deleted_at: string | null;
}

/** The channel triple a deliverable's provenance is stamped with. */
interface Provenance {
	channelId: string;
	channelName: string;
	channelKind: ChannelKind;
}

// #endregion

// #region Formatting (UTC only)

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/**
 * Every pre-formatted label below is derived with `getUTC*` — never `Intl`, never local time.
 *
 * The server renders these strings into the first byte and the explorer island re-renders the same
 * page from its own refetch. `Intl` resolves against the RUNTIME's locale and zone — Deno's on the
 * server, the viewer's in the browser — so the two halves would disagree on the same row, a mismatch
 * that only appears outside the author's own timezone. UTC is the one clock both ends share, and the
 * fixtures document and follow the same rule; matching it is what keeps a live page and a stubbed one
 * visually identical.
 */
function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** "Today" / "Yesterday" / "Mon, Jul 14", relative to the request's own clock in UTC. */
function fmtDay(ms: number, nowMs: number): string {
	const diff = Math.floor(nowMs / DAY_MS) - Math.floor(ms / DAY_MS);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Jul 14 · 2:30 PM". */
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}

/** "2.4 MB". */
function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

/** Milliseconds from a timestamptz string, falling back for an absent or unparseable value. */
function msOf(iso: string | null | undefined, fallback: number): number {
	if (!iso) return fallback;
	const parsed = Date.parse(iso);
	return Number.isNaN(parsed) ? fallback : parsed;
}

// #endregion

// #region Small helpers

function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

/** Split a list into `.in()`-sized batches. See {@link ID_CHUNK}. */
function chunk<T>(values: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
	return out;
}

/**
 * A {@link MessageSender} from a party row, with this projection's own bounds applied.
 *
 * `senderOf` owns the SHAPE (and the reasons `avatar` is always null); the clamping happens here
 * because the bounds are per-projection — `MessageSender.name` is `max(120)` and `handle` is
 * `max(40)`, while a sibling projection of the same person carries different ones. Applying them at
 * the mapping boundary is the truncation contract: a 200-character display name must not fail a page.
 */
function senderFrom(userId: string, row: PartyRow | undefined): MessageSender {
	const base = senderOf(userId, row);
	return {
		id: clampOr(base.id, 80, userId),
		name: clampOr(base.name, 120, "Unknown"),
		avatar: null,
		handle: base.handle ? clamp(base.handle, 40) : null,
	};
}

// #endregion

// #region Asset mapping

/**
 * One `files.items` row → the {@link FileItem} the shared grid, table and preview modal render.
 *
 * ## What has no column, and is therefore returned neutral rather than guessed
 *
 * - **`url` / `thumbnailUrl`.** A stored object is addressed by `(bucket_id, storage_path)`, and
 *   turning that into something a browser can fetch means SIGNING it through the Storage API — a
 *   separate POST, not a PostgREST read. Emitting a composed public path instead would 403 on every
 *   private object, which renders as a broken image on every tile rather than the category glyph the
 *   card already draws for `"#"`. A `link` asset is the exception: its URL *is* its content.
 * - **`width` / `height` / `durationLabel`.** `files.items.metadata` is an untyped `jsonb` with no
 *   writer contract anywhere in the schema, so reading a key out of it would be guessing at a shape
 *   rather than reading a column. Null costs the grid its intrinsic aspect ratio; a wrong number
 *   costs it the layout.
 * - **`external`.** `ExternalRefSchema` requires `providerSlug`, which lives in
 *   `integrations.providers` — and `integrations` is NOT one of the schemas `config.toml` exposes, so
 *   PostgREST cannot reach it at all. A mounted asset therefore carries no connector back-reference
 *   on this path; it is not a lookup that was skipped, it is one that cannot be issued.
 * - **`downloadedByViewer`.** Answerable only from `files.download_events`, which is server-written.
 *   `false` is the safe direction: it shows the duplicate-download prompt to somebody who has already
 *   downloaded, where `true` would suppress it for somebody who has not.
 *
 * ## `starred` is the OWNER's mark, not the viewer's
 *
 * `files.items.starred` carries an explicit scope warning in its own migration: it is the owner's
 * shelf mark on their own asset, and per-viewer starring would be a `(user_id, item_id)` pivot that
 * does not exist. `AssetItem.starred` is documented as "whether the ACTOR starred this asset". Those
 * are the same fact only when the actor owns the row, so the column is read only then — otherwise a
 * client reviewing a freelancer's deliverable would see, and toggle, the freelancer's star.
 */
function toFileItem(
	row: FileRow,
	opts: {
		viewerId: string;
		provenance: Provenance;
		submission: SubmissionRow;
		sender: MessageSender;
		nowMs: number;
	},
): FileItem {
	const name = clampOr(row.display_name, 200, clampOr(row.original_name, 200, "Untitled"));
	const category =
		(row.category && Object.hasOwn(CATEGORY_META, row.category)
			? row.category
			: "Other") as FileCategory;
	const sizeBytes = Math.max(0, Math.trunc(Number(row.size_bytes ?? 0)) || 0);
	const created = msOf(row.created_at, opts.nowMs);
	const isOwner = row.owner_user_id === opts.viewerId;
	const source = (row.source && SOURCES.has(row.source) ? row.source : "supabase") as AssetSource;
	const ownerType =
		(row.owner_type && OWNER_TYPES.has(row.owner_type) ? row.owner_type : "user") as AssetOwnerType;

	return {
		id: clampOr(row.id, 120, row.id),
		kind: categoryToKind(category),
		category,
		name,
		ext: clamp(fileExtension(name), 12),
		url: source === "link" ? clamp(row.link_url, 2000) || "#" : "#",
		thumbnailUrl: null,
		sizeBytes,
		sizeLabel: clamp(fmtSize(sizeBytes), 16),
		width: null,
		height: null,
		durationLabel: null,

		// Synthesised provenance — see the module docblock. The submission is the carousel group.
		channelId: opts.provenance.channelId,
		channelName: opts.provenance.channelName,
		channelKind: opts.provenance.channelKind,
		messageId: clampOr(opts.submission.id, 120, opts.submission.id),
		messageText: clamp(opts.submission.notes, 4000),
		messageAudioUrl: null,
		sender: opts.sender,

		createdAt: new Date(created).toISOString(),
		timeLabel: clamp(fmtTime(created), 20),
		dayLabel: clamp(fmtDay(created, opts.nowMs), 24),
		dateLabel: clamp(fmtDateTime(created), 28),
		starred: isOwner ? row.starred === true : false,

		source,
		status: (row.status && STATUSES.has(row.status) ? row.status : "uploaded") as FileStatus,
		visibility:
			(row.visibility && VISIBILITIES.has(row.visibility)
				? row.visibility
				: "private") as AssetVisibility,
		ownerType,
		ownerId: clampOr(
			ownerType === "user" ? row.owner_user_id : (row.owner_entity_id ?? row.owner_user_id),
			80,
			row.owner_user_id,
		),
		folderId: row.folder_id ? clamp(row.folder_id, 120) : null,
		// See the module docblock: the owning folder chain is the SUBMITTER's private library
		// organisation, and materialising its names here would disclose it inside the client's tree.
		folderPath: [],
		contentHash: row.content_hash ? clamp(row.content_hash, 128) : null,
		hashSampled: row.hash_sampled === true,
		external: null,
		link: toLinkAttachment(row, source),
		shareSlug: row.share_slug ? clamp(row.share_slug, 64) : null,
		downloadCount: Math.max(0, Math.trunc(row.download_count ?? 0)),
		downloadedByViewer: false,
		// A server decision, never inferred client-side. The `files.items` UPDATE and DELETE policies
		// are both `owner_user_id = auth.uid()`, so this mirrors what Postgres would actually permit.
		canManage: isOwner,
	};
}

/**
 * The `link` facet for a link asset, or `null` for anything with bytes.
 *
 * **Contract contradiction, resolved in the lossy-but-visible direction.**
 * `LinkAttachmentSchema.scanStatus` is a REQUIRED member of a five-value enum, but
 * `files.items.link_scan_status` is nullable and its own migration is explicit that NULL means "the
 * safety pipeline has not run at all", deliberately distinct from `pending` ("queued"). The Zod enum
 * has no way to say the first, so a never-scanned link is reported as `pending`. That overstates the
 * pipeline by one step; the alternative — dropping the whole facet — would take the URL with it, and
 * the URL is the entire asset. Reconciling the two is a data decision.
 */
function toLinkAttachment(row: FileRow, source: AssetSource): FileItem["link"] {
	if (source !== "link" || !row.link_url) return null;
	const url = clamp(row.link_url, 2000);
	let host = clamp(row.link_domain, 253).trim();
	if (!host) {
		try {
			host = clamp(new URL(url).hostname, 253);
		} catch {
			host = "";
		}
	}
	const domain = host || "link";
	const scan = row.link_scan_status && SCAN_STATUSES.has(row.link_scan_status)
		? (row.link_scan_status as LinkScanStatus)
		: "pending";
	return {
		url,
		domain,
		title: clampOr(row.link_title, 300, domain),
		description: row.link_description ? clamp(row.link_description, 600) : null,
		faviconUrl: row.link_favicon_url ? clamp(row.link_favicon_url, 600) : null,
		scanStatus: scan,
		scannedAt: row.link_scanned_at ?? null,
	};
}

// #endregion

// #region Internal tree model

/** A pre-wire tree node carrying the files it holds directly plus, for a unit, its source row. */
interface Node {
	segment: string;
	kind: SubmissionNodeKind;
	label: string;
	sublabel: string | null;
	handle: string | null;
	status: SubmissionStatus | null;
	files: FileItem[];
	children: Node[];
	unit: UnitContext | null;
}

/** Everything a unit node needs to answer the review projection without a second read. */
interface UnitContext {
	row: SubmissionRow;
	kind: SubmissionUnitKind;
	status: SubmissionStatus;
	submitter: MessageSender;
	stage: StageRow;
	ticketTitle: string | null;
	ticketSummary: string | null;
	notes: SubmissionNote[];
	createdMs: number;
}

function recFiles(node: Node): FileItem[] {
	return node.files.concat(...node.children.map(recFiles));
}

function recCount(node: Node): number {
	return node.files.length + node.children.reduce((sum, child) => sum + recCount(child), 0);
}

/**
 * The wire shape. `avatar` is always null: `org.users_public.avatar_file_id` is a FK into
 * `files.items`, not a URL, so a served path cannot be composed here — the tree draws the initials
 * fallback instead, which is what a null already means to it.
 */
function toWire(node: Node): SubmissionTreeNode {
	return {
		segment: node.segment,
		kind: node.kind,
		label: node.label,
		sublabel: node.sublabel,
		avatar: null,
		handle: node.handle,
		status: node.status,
		fileCount: recCount(node),
		children: node.children.map(toWire),
	};
}

/** Walk `path` from the roots, returning the matched chain — which may be shorter than `path`. */
function resolveChain(roots: readonly Node[], path: readonly string[]): Node[] {
	const chain: Node[] = [];
	let level: readonly Node[] = roots;
	for (const segment of path) {
		const found = level.find((node) => node.segment === segment);
		if (!found) break;
		chain.push(found);
		level = found.children;
	}
	return chain;
}

// #endregion

// #region Naming and notes

/**
 * How a submission is named, and which {@link SubmissionUnitKind} that makes it.
 *
 * `stage_submissions.title` is `NOT NULL` but an empty string is storable in a `text` column, so "has
 * a title" is a real question rather than a settled one. The ladder follows the enum's own definition
 * — the freelancer's chosen label, else the ticket it fulfils, else the time it arrived.
 *
 * There is no human ticket reference column anywhere (`projects.tickets` has an id and a title and
 * nothing in between), so a ticket-named unit is labelled by its title alone; the uuid travels in
 * `SubmissionUnit.ticketId` for linking, where it is addressable without being read aloud.
 */
function nameSubmission(
	row: SubmissionRow,
	ticketTitle: string | null,
	createdMs: number,
): { kind: SubmissionUnitKind; label: string } {
	const title = clamp(row.title, 200).trim();
	if (title) return { kind: "custom", label: title };
	if (ticketTitle) return { kind: "ticket", label: ticketTitle };
	return { kind: "timestamp", label: `Submission · ${fmtDateTime(createdMs)}` };
}

/**
 * The review notes on a submission.
 *
 * `projects.review_submission` is the only writer of `stage_submissions.feedback`, and the only key
 * the schema itself relies on is `feedback->>'global'` (it copies that string into the
 * `stage_revision_requests.reason` it raises). So exactly that one key is read. Per-FILE annotations
 * have no persisted shape at all — nothing writes one, and inventing a container to read out of would
 * be designing the schema rather than reading it — so `SubmissionNote.fileId` is always `null` here,
 * and the unit-level note is the whole of what a live review can report.
 *
 * A feedback string with no `reviewed_by` yields NO note rather than one attributed to nobody:
 * `SubmissionNote.author.id` is `min(1)`, and the two columns are written in the same statement, so a
 * row carrying one without the other is inconsistent rather than merely partial.
 *
 * Notes are emitted for every status, not only `revision_requested` — `review_submission` sets
 * `feedback` on an acceptance too, and a client who wrote a note on work they approved should be able
 * to find it again.
 */
function notesFrom(
	row: SubmissionRow,
	parties: Map<string, PartyRow>,
	fallbackMs: number,
): SubmissionNote[] {
	const global = row.feedback && typeof row.feedback.global === "string"
		? row.feedback.global.trim()
		: "";
	if (!global || !row.reviewed_by) return [];
	const created = msOf(row.reviewed_at ?? row.updated_at, fallbackMs);
	return [{
		id: clampOr(`${row.id}-feedback`, 80, "feedback"),
		author: senderFrom(row.reviewed_by, parties.get(row.reviewed_by)),
		text: clamp(global, 4000),
		fileId: null,
		createdAt: new Date(created).toISOString(),
		dateLabel: clamp(fmtDateTime(created), 28),
	}];
}

// #endregion

// #region Queries

/**
 * The engagement, by slug.
 *
 * `projects.projects.slug` is the address — its own migration says every `/projects` route resolves
 * by slug and never by uuid — so the slug is tried first. The id is tried only when the value is
 * uuid-SHAPED, because the param is named `projectId` and a caller handing over a real id would
 * otherwise get a silent 404. The shape test is not decoration: `.eq("id", "some-slug")` raises
 * `22P02 invalid input syntax for type uuid`, which is a thrown page rather than a miss.
 */
async function resolveProject(
	db: SupabaseClient,
	projectId: string,
): Promise<ProjectRow | null> {
	const bySlug = await db.from("projects").select(PROJECT_COLUMNS).eq("slug", projectId)
		.maybeSingle();
	if (bySlug.error) {
		throw new Error(`projects.projects slug read failed: ${bySlug.error.message}`);
	}
	if (bySlug.data) return bySlug.data as unknown as ProjectRow;
	if (!isUuid(projectId)) return null;

	const byId = await db.from("projects").select(PROJECT_COLUMNS).eq("id", projectId).maybeSingle();
	if (byId.error) {
		throw new Error(`projects.projects id read failed: ${byId.error.message}`);
	}
	return (byId.data as unknown as ProjectRow) ?? null;
}

/**
 * Whether the acting viewer is the client/reviewer for this engagement.
 *
 * A TypeScript mirror of `projects.can_review_project` — the owner, or an active member of the paying
 * client business — rather than an RPC call to it, so the answer needs no `EXECUTE` grant that no
 * migration actually issues (only `projects.is_protected_phase` is granted; the rest rely on
 * Postgres's default PUBLIC execute, which a later revoke would remove without a compile error here).
 *
 * The membership lookup is SECONDARY: a failure degrades to "not the reviewer", which HIDES the
 * Review action rather than offering one the server would then refuse, and TIGHTENS isolation rather
 * than loosening it. The failure direction is the safe one on both counts.
 */
async function resolveViewerIsReviewer(
	actor: ReadActor & { accessToken: string },
	project: ProjectRow,
): Promise<boolean> {
	if (project.owner_user_id === actor.userId) return true;
	if (!project.client_business_id) return false;

	const { data, error } = await orgDb(actor)
		.from("business_members")
		.select("user_id")
		.eq("business_id", project.client_business_id)
		.eq("user_id", actor.userId)
		.eq("status", "active")
		.limit(1);
	if (error) return false;
	return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Whether this read is narrowed to the acting viewer's own submissions.
 *
 * The whole of the isolation rule, in one place. A reviewer may set `asFreelancer` in either
 * direction — for them `true` is a request to see the surface as their counterpart does, and it can
 * only remove rows. Anybody else is isolated unconditionally, because for them `false` is a request
 * to see a peer's deliverables and the request is not the authority on that. `asFreelancer` is
 * documented as "re-derived server-side and never grants access"; on the live path, re-deriving it is
 * the only thing that makes the sentence true, since RLS admits every participant to every submission
 * in the project.
 */
function resolveIsolation(viewerIsReviewer: boolean, params: SubmissionListParams): boolean {
	if (!viewerIsReviewer) return true;
	return params.asFreelancer === true;
}

/**
 * The stages in scope.
 *
 * Project scope is every stage, ordered by `sort_order` — the roots of the tree. Channel scope is the
 * ONE stage the channel belongs to: `comms.project_channels.stage_id` is the only edge between a
 * channel and a deliverable, and `projects.stage_submissions` is keyed on a stage, so a general, team
 * or DM channel has no submissions to show and correctly resolves to an empty tree rather than to the
 * whole project's.
 *
 * A channel id that is not uuid-shaped, names a channel in another project, or cannot be read at all
 * resolves to NO stages — never to every stage. Widening on a failed narrowing is how a scoped view
 * quietly becomes an unscoped one.
 */
async function resolveStages(
	actor: ReadActor & { accessToken: string },
	db: SupabaseClient,
	project: ProjectRow,
	channelId: string | null,
): Promise<StageRow[]> {
	const { data, error } = await db
		.from("project_stages")
		.select(STAGE_COLUMNS)
		.eq("project_id", project.id)
		.order("sort_order", { ascending: true });
	if (error) throw new Error(`projects.project_stages read failed: ${error.message}`);
	const stages = (data ?? []) as unknown as StageRow[];
	if (!channelId) return stages;
	if (!isUuid(channelId)) return [];

	const channel = await commsDb(actor)
		.from("project_channels")
		.select("id, project_id, stage_id")
		.eq("id", channelId)
		.maybeSingle();
	// A withheld or missing channel row is not an outage — it is a scope that resolves to nothing.
	if (channel.error || !channel.data) return [];
	const row = channel.data as unknown as { project_id: string; stage_id: string | null };
	if (row.project_id !== project.id || !row.stage_id) return [];
	return stages.filter((stage) => stage.id === row.stage_id);
}

/**
 * The submissions on the given stages, newest first.
 *
 * **No `status` predicate, deliberately.** The column is nullable and a SQL CHECK is NULL-tolerant, so
 * an explicit NULL is storable and satisfies the constraint — which means any `.eq("status", …)` or
 * `.in("status", […])` silently drops those rows, and a submission genuinely awaiting review would
 * simply not appear. Reading every row and letting `toSubmissionStatus` land a NULL on `draft` keeps
 * the row visible and mislabels it at worst.
 *
 * **Consequence worth surfacing rather than resolving here:** that also means a reviewer sees another
 * person's `draft` — work that has not been sent. RLS permits it and the fixture read shows it, so
 * this path mirrors both rather than inventing a visibility rule the rest of the domain does not
 * have. Whether an unsent draft belongs in a client's review tree is a product decision.
 */
async function fetchSubmissions(
	db: SupabaseClient,
	stageIds: readonly string[],
	isolatedTo: string | null,
): Promise<SubmissionRow[]> {
	if (stageIds.length === 0) return [];
	let query = db
		.from("stage_submissions")
		.select(SUBMISSION_COLUMNS)
		.in("project_stage_id", stageIds as string[]);
	// The isolation narrowing, applied to the QUERY. A peer's row is never fetched, so no later
	// mapping, filter or serialisation step can leak one.
	if (isolatedTo) query = query.eq("submitted_by", isolatedTo);

	const { data, error } = await query
		.order("created_at", { ascending: false })
		.limit(SUBMISSION_ROW_CAP);
	if (error) throw new Error(`projects.stage_submissions read failed: ${error.message}`);
	return (data ?? []) as unknown as SubmissionRow[];
}

/**
 * The `files.items` rows behind a set of submissions, grouped by submission id.
 *
 * Two keyed reads rather than an embed: `projects.submission_files` is the pivot and `files.items`
 * lives in another exposed schema. Both are chunked, because a project's whole deliverable corpus can
 * reference more ids than one request URL holds.
 *
 * A file whose pivot row is visible may still be absent from the second read, and that is a normal
 * outcome rather than an error: `files.fn_can_read` grants a non-owner access only through entity
 * membership or the `project` bucket's path anchor, so a deliverable a freelancer uploaded into their
 * personal library is readable by them and withheld from the reviewer. The unit then renders with
 * fewer files instead of failing — the same degradation `fetchParties` makes for a withheld profile.
 */
async function fetchSubmissionFiles(
	actor: ReadActor & { accessToken: string },
	db: SupabaseClient,
	submissionIds: readonly string[],
): Promise<Map<string, FileRow[]>> {
	const grouped = new Map<string, FileRow[]>();
	if (submissionIds.length === 0) return grouped;

	const pivots: { submission_id: string; file_id: string }[] = [];
	for (const batch of chunk(submissionIds, ID_CHUNK)) {
		const { data, error } = await db
			.from("submission_files")
			.select("submission_id, file_id")
			.in("submission_id", batch)
			.limit(FILE_ROW_CAP);
		if (error) throw new Error(`projects.submission_files read failed: ${error.message}`);
		pivots.push(...((data ?? []) as unknown as { submission_id: string; file_id: string }[]));
	}
	if (pivots.length === 0) return grouped;

	const fileIds = [...new Set(pivots.map((pivot) => pivot.file_id))].slice(0, FILE_ROW_CAP);
	const items = new Map<string, FileRow>();
	for (const batch of chunk(fileIds, ID_CHUNK)) {
		const { data, error } = await filesDb(actor)
			.from("items")
			.select(FILE_COLUMNS)
			.in("id", batch)
			.is("deleted_at", null);
		if (error) throw new Error(`files.items read failed: ${error.message}`);
		for (const row of (data ?? []) as unknown as FileRow[]) items.set(row.id, row);
	}

	for (const pivot of pivots) {
		const row = items.get(pivot.file_id);
		if (!row) continue;
		const bucket = grouped.get(pivot.submission_id) ?? [];
		bucket.push(row);
		grouped.set(pivot.submission_id, bucket);
	}
	return grouped;
}

/**
 * Channel provenance per stage id.
 *
 * Secondary: a stage whose chat channel is missing or withheld by `comms.has_channel_access` falls
 * back to its own identity ({@link provenanceFor}), which names the right container even though it is
 * not a channel id. Throwing here would take a page of deliverables down over the label above them.
 */
async function fetchStageChannels(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<Map<string, { id: string; name: string }>> {
	const byStage = new Map<string, { id: string; name: string }>();
	const { data, error } = await commsDb(actor)
		.from("project_channels")
		.select("id, name, stage_id")
		.eq("project_id", projectId);
	if (error) return byStage;
	type Row = { id: string; name: string | null; stage_id: string | null };
	for (const row of (data ?? []) as unknown as Row[]) {
		if (!row.stage_id || byStage.has(row.stage_id)) continue;
		byStage.set(row.stage_id, { id: row.id, name: clamp(row.name, 160) });
	}
	return byStage;
}

/** Ticket titles and summaries for the units that fulfil one. Secondary: a miss leaves both null. */
async function fetchTickets(
	db: SupabaseClient,
	ticketIds: readonly string[],
): Promise<Map<string, { title: string; summary: string }>> {
	const out = new Map<string, { title: string; summary: string }>();
	if (ticketIds.length === 0) return out;
	for (const batch of chunk([...new Set(ticketIds)], ID_CHUNK)) {
		const { data, error } = await db
			.from("tickets")
			.select("id, title, text_description")
			.in("id", batch);
		if (error) continue;
		type Row = { id: string; title: string | null; text_description: string | null };
		for (const row of (data ?? []) as unknown as Row[]) {
			out.set(row.id, {
				title: clamp(row.title, 200),
				summary: clamp(row.text_description, 1200),
			});
		}
	}
	return out;
}

/**
 * How many distinct providers are STAFFED on each stage.
 *
 * Used only to decide whether the submitter level collapses. Staffing is the honest input to that
 * question rather than "how many people have submitted so far": a two-person stage where only one has
 * delivered is still a two-person stage, and collapsing it would hide whose work the client is
 * looking at right up until the second person arrives — at which point the tree would silently change
 * shape under them.
 *
 * A team assignment counts as one provider under its `team_id`, since `freelancer_profile_id` is NULL
 * for that `assignee_type` and the team is what was staffed. Secondary: an empty result falls the
 * decision back to the submitter count, which is the fixture's rule.
 */
async function fetchStageProviders(
	db: SupabaseClient,
	stageIds: readonly string[],
): Promise<Map<string, Set<string>>> {
	const out = new Map<string, Set<string>>();
	if (stageIds.length === 0) return out;
	const { data, error } = await db
		.from("stage_assignments")
		.select("project_stage_id, freelancer_profile_id, team_id, status")
		.in("project_stage_id", stageIds as string[]);
	if (error) return out;
	type Row = {
		project_stage_id: string;
		freelancer_profile_id: string | null;
		team_id: string | null;
		status: string | null;
	};
	for (const row of (data ?? []) as unknown as Row[]) {
		if (row.status && INACTIVE_ASSIGNMENT.has(row.status)) continue;
		const provider = row.freelancer_profile_id ?? row.team_id;
		if (!provider) continue;
		const set = out.get(row.project_stage_id) ?? new Set<string>();
		set.add(provider);
		out.set(row.project_stage_id, set);
	}
	return out;
}

// #endregion

// #region Filter, sort and page

function matches(item: FileItem, params: SubmissionListParams): boolean {
	if (params.kinds && params.kinds.length > 0 && !params.kinds.includes(item.kind)) return false;
	if (params.query) {
		const q = params.query.trim().toLowerCase();
		if (q && !item.name.toLowerCase().includes(q)) return false;
	}
	return true;
}

const SORTERS: Record<FileSortKey, (a: FileItem, b: FileItem) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	date: (a, b) => a.createdAt.localeCompare(b.createdAt),
	size: (a, b) => a.sizeBytes - b.sizeBytes,
	sender: (a, b) => a.sender.name.localeCompare(b.sender.name),
	type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
};

/** Sorted with the file id as the tie-break, so a cursor always addresses exactly one row. */
function sortItems(items: FileItem[], sort: FileSortKey, dir: FileSortDir): FileItem[] {
	const cmp = SORTERS[sort];
	const sorted = items.slice().sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
	return dir === "desc" ? sorted.reverse() : sorted;
}

// #endregion

// #region Tree assembly

/** The channel triple for a stage, falling back to the stage's own identity. See {@link toFileItem}. */
function provenanceFor(
	stage: StageRow,
	channels: Map<string, { id: string; name: string }>,
): Provenance {
	const channel = channels.get(stage.id);
	const stageName = clampOr(stage.name, 160, "Stage");
	return {
		channelId: clampOr(channel?.id ?? stage.id, 120, stage.id),
		channelName: clampOr(channel?.name ?? stageName, 160, stageName),
		channelKind: "stage",
	};
}

/** Everything resolved once per page and threaded through the tree build. */
interface BuildContext {
	viewerId: string;
	nowMs: number;
	parties: Map<string, PartyRow>;
	tickets: Map<string, { title: string; summary: string }>;
	filesBySubmission: Map<string, FileRow[]>;
	channels: Map<string, { id: string; name: string }>;
	providers: Map<string, Set<string>>;
	projectScope: boolean;
	isolated: boolean;
}

/** One submission → a `unit` node holding its files directly (there is no `dir` level; see the docblock). */
function buildUnitNode(row: SubmissionRow, stage: StageRow, ctx: BuildContext): Node {
	const createdMs = msOf(row.created_at, ctx.nowMs);
	const ticket = row.ticket_id ? ctx.tickets.get(row.ticket_id) : undefined;
	const ticketTitle = ticket?.title ? ticket.title : null;
	const named = nameSubmission(row, ticketTitle, createdMs);
	const status = toSubmissionStatus(row.status);
	const submitter = senderFrom(row.submitted_by, ctx.parties.get(row.submitted_by));
	const provenance = provenanceFor(stage, ctx.channels);

	const files = (ctx.filesBySubmission.get(row.id) ?? []).map((file) =>
		toFileItem(file, {
			viewerId: ctx.viewerId,
			provenance,
			submission: row,
			sender: submitter,
			nowMs: ctx.nowMs,
		})
	);

	return {
		// The submission's own id: globally unique, so a sibling with a repeated custom title can never
		// collide, and stable across a rename in a way a slug of the title would not be.
		segment: clampOr(row.id, 120, row.id),
		kind: "unit",
		label: clampOr(named.label, 200, "Submission"),
		sublabel: ctx.projectScope
			? (clamp(stage.name, 200) || null)
			: (named.kind === "ticket" ? "Ticket" : null),
		handle: null,
		status,
		files,
		children: [],
		unit: {
			row,
			kind: named.kind,
			status,
			submitter,
			stage,
			ticketTitle,
			ticketSummary: ticket?.summary ? ticket.summary : null,
			notes: notesFrom(row, ctx.parties, ctx.nowMs),
			createdMs,
		},
	};
}

/** One submitter → a `submitter` node over their units on this stage. */
function buildSubmitterNode(
	userId: string,
	rows: readonly SubmissionRow[],
	stage: StageRow,
	ctx: BuildContext,
): Node {
	const submitter = senderFrom(userId, ctx.parties.get(userId));
	return {
		// The user id, not a slug of the handle: a username is mutable and a segment chain is a URL, so
		// a handle-derived segment would break every deep link the day somebody renames themselves. It
		// also stays buildable when RLS withholds the profile row entirely.
		segment: clampOr(userId, 120, userId),
		kind: "submitter",
		label: submitter.name,
		sublabel: "Freelancer",
		handle: submitter.handle,
		status: null,
		files: [],
		children: rows.map((row) => buildUnitNode(row, stage, ctx)),
		unit: null,
	};
}

/**
 * A stage's children: its units directly when one provider works it, its submitters otherwise.
 *
 * The collapse needs BOTH counts to agree — one staffed provider and one actual submitter. Staffing
 * alone would collapse a stage a second person has already delivered into; submitters alone would
 * collapse a two-person stage until the second one arrives, at which point the tree would silently
 * change shape under the reader.
 *
 * **An isolated read collapses unconditionally**, and the staffing signal is deliberately ignored
 * there. Staffing answers "how many people's work might appear under this stage"; once
 * {@link resolveIsolation} has narrowed the query to one person the answer is one by construction, so
 * consulting it would build a submitter level holding exactly one child that is always the viewer
 * themselves — a level whose only content is the name they already know.
 */
function buildStageChildren(
	stage: StageRow,
	rows: readonly SubmissionRow[],
	ctx: BuildContext,
): { children: Node[]; collapsed: boolean; submitters: Set<string> } {
	const bySubmitter = new Map<string, SubmissionRow[]>();
	for (const row of rows) {
		const bucket = bySubmitter.get(row.submitted_by) ?? [];
		bucket.push(row);
		bySubmitter.set(row.submitted_by, bucket);
	}
	const submitters = new Set(bySubmitter.keys());
	const staffed = ctx.isolated ? 0 : (ctx.providers.get(stage.id)?.size ?? 0);
	const collapsed = submitters.size <= 1 && staffed <= 1;

	const children = collapsed
		? rows.map((row) => buildUnitNode(row, stage, ctx))
		: [...bySubmitter.entries()].map(([userId, own]) =>
			buildSubmitterNode(userId, own, stage, ctx)
		);
	return { children, collapsed, submitters };
}

// #endregion

// #region Review projection

function buildUnit(node: Node, path: readonly string[]): SubmissionUnit | null {
	const ctx = node.unit;
	if (!ctx) return null;
	return {
		path: [...path],
		name: node.label,
		kind: ctx.kind,
		status: ctx.status,
		submitter: ctx.submitter,
		stageId: clamp(ctx.stage.id, 80),
		stageName: clamp(ctx.stage.name, 120),
		ticketId: ctx.row.ticket_id ? clamp(ctx.row.ticket_id, 80) : null,
		ticketTitle: ctx.ticketTitle,
		createdAt: new Date(ctx.createdMs).toISOString(),
		dateLabel: clamp(fmtDateTime(ctx.createdMs), 28),
		fileCount: recCount(node),
		noteCount: ctx.notes.length,
	};
}

/**
 * The review workspace's context sidebar.
 *
 * `stageSummary` is required and comes from `projects.project_stages.description_text`, which is
 * `NOT NULL DEFAULT ''` — so an undescribed stage yields an EMPTY summary rather than a sentence this
 * module composed about escrow and revisions. The fixtures can write that prose because they also
 * invent the stage; a live read would be putting words about somebody's money into a panel that reads
 * as the platform's own description of their agreement.
 *
 * `stageStatus` is projected through `toStageProjectStatus` so the review header speaks the same
 * status vocabulary as the tree node above it. The raw `stage_status` member would not: the two enums
 * overlap on `cancelled` and nothing else.
 */
function buildReview(node: Node, unit: SubmissionUnit): SubmissionReview | null {
	const ctx = node.unit;
	if (!ctx) return null;
	return {
		unit,
		stageName: clamp(ctx.stage.name, 120),
		stageStatus: clamp(toStageProjectStatus(ctx.stage.status), 40),
		stageSummary: clamp(ctx.stage.description_text, 1200),
		ticketTitle: ctx.ticketTitle,
		ticketSummary: ctx.ticketSummary,
		notes: ctx.notes,
	};
}

// #endregion

// #region Public entry point

/**
 * A page of the Submissions explorer, or `null` when the engagement does not resolve.
 *
 * `null` is "no such project, or none this viewer may see" — the route maps it to a 404, and the two
 * are deliberately indistinguishable from outside, since telling them apart would confirm the
 * existence of a private engagement to somebody who cannot read it. A THROWN error is a genuine query
 * failure and names the table it came from; the calling service catches it, logs it, and falls back to
 * fixtures.
 *
 * Every secondary lookup — parties, tickets, channels, staffing, business membership — degrades to a
 * neutral value instead of throwing, so one withheld join cannot take down a page that otherwise
 * resolved. The primary reads (the project, its stages, its submissions and their files) throw,
 * because a page missing those is not a degraded page but a wrong one.
 */
export async function fetchSubmissionPage(
	actor: ReadActor & { accessToken: string },
	params: SubmissionListParams,
): Promise<SubmissionListPage | null> {
	const db = projectsDb(actor);
	const project = await resolveProject(db, params.projectId);
	if (!project) return null;

	const channelId = params.channelId ?? null;
	const projectScope = channelId === null;

	// Isolation is resolved BEFORE the submissions read so that it can narrow the QUERY rather than
	// the result. Reversing these two steps would be the whole defect.
	const viewerIsReviewer = await resolveViewerIsReviewer(actor, project);
	const isolate = resolveIsolation(viewerIsReviewer, params);

	const stages = await resolveStages(actor, db, project, channelId);
	const stageIds = stages.map((stage) => stage.id);
	const submissions = await fetchSubmissions(db, stageIds, isolate ? actor.userId : null);
	submissions.sort((a, b) => byNewest(a.created_at, b.created_at));

	const submissionIds = submissions.map((row) => row.id);
	const ticketIds = submissions
		.map((row) => row.ticket_id)
		.filter((id): id is string => !!id);

	// Five independent lookups over the same page, issued together: none depends on another's result,
	// and awaiting them in series would add all five latencies to every navigation.
	const [filesBySubmission, parties, tickets, channels, providers] = await Promise.all([
		fetchSubmissionFiles(actor, db, submissionIds),
		fetchParties(actor, [
			...submissions.map((row) => row.submitted_by),
			...submissions.map((row) => row.reviewed_by),
		]),
		fetchTickets(db, ticketIds),
		fetchStageChannels(actor, project.id),
		fetchStageProviders(db, stageIds),
	]);

	const ctx: BuildContext = {
		viewerId: actor.userId,
		nowMs: Date.now(),
		parties,
		tickets,
		filesBySubmission,
		channels,
		providers,
		projectScope,
		isolated: isolate,
	};

	const byStage = new Map<string, SubmissionRow[]>();
	for (const row of submissions) {
		const bucket = byStage.get(row.project_stage_id) ?? [];
		bucket.push(row);
		byStage.set(row.project_stage_id, bucket);
	}

	const roots: Node[] = [];
	const allSubmitters = new Set<string>();
	const allProviders = new Set<string>();
	let everyStageCollapsed = true;

	for (const stage of stages) {
		const built = buildStageChildren(stage, byStage.get(stage.id) ?? [], ctx);
		for (const id of built.submitters) allSubmitters.add(id);
		for (const id of providers.get(stage.id) ?? []) allProviders.add(id);
		if (!built.collapsed) everyStageCollapsed = false;

		if (projectScope) {
			roots.push({
				segment: clampOr(stage.id, 120, stage.id),
				kind: "stage",
				label: clampOr(stage.name, 200, "Stage"),
				sublabel: clamp(toStageProjectStatus(stage.status), 200),
				handle: null,
				status: null,
				files: [],
				children: built.children,
				unit: null,
			});
		} else {
			// Channel scope starts at the submitter level: the one stage the channel belongs to IS the
			// scope, so re-rendering it as a root the reader must click through says nothing.
			roots.push(...built.children);
		}
	}

	const chain = resolveChain(roots, params.path ?? []);
	const resolvedPath = chain.map((node) => node.segment);
	const scopedFiles = chain.length > 0
		? recFiles(chain[chain.length - 1])
		: roots.flatMap(recFiles);

	// The active unit is the first `unit` node in the resolved chain — the node itself when a unit was
	// selected, or its ancestor when the selection went deeper.
	let activeUnit: SubmissionUnit | null = null;
	let review: SubmissionReview | null = null;
	for (let i = 0; i < chain.length; i++) {
		if (chain[i].kind !== "unit") continue;
		const unit = buildUnit(chain[i], resolvedPath.slice(0, i + 1));
		if (unit) {
			activeUnit = unit;
			review = buildReview(chain[i], unit);
		}
		break;
	}

	const breadcrumbs: SubmissionCrumb[] = [
		{ label: projectScope ? "All stages" : "Submissions", kind: "stage", path: [] },
		...chain.map((node, i) => ({
			label: node.label,
			kind: node.kind,
			path: resolvedPath.slice(0, i + 1),
		})),
	];

	const sort: FileSortKey = params.sort ?? "date";
	const dir: FileSortDir = params.dir ?? (sort === "date" ? "desc" : "asc");
	const sorted = sortItems(scopedFiles.filter((item) => matches(item, params)), sort, dir);
	const total = sorted.length;

	const limit = Math.min(200, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const index = sorted.findIndex((item) => item.id === params.cursor);
		start = index === -1 ? 0 : index + 1;
	}
	const items = sorted.slice(start, start + limit);
	const hasMore = start + limit < total;

	return {
		scope: projectScope ? "project" : "channel",
		projectId: params.projectId,
		projectTitle: clampOr(project.title, 160, "Untitled project"),
		format: (FORMATS.has(project.format) ? project.format : "pipeline") as ProjectFormat,
		channelId: channelId ? clamp(channelId, 120) : null,
		// In channel scope `resolveStages` has already narrowed to the one stage that channel belongs to
		// (and to NOTHING when the channel is general or not this project's), so the single survivor is
		// the anchor. Null in project scope, where the stage is whichever one the reader navigates into.
		stageId: projectScope ? null : (stages[0]?.id ?? null),
		tree: roots.map(toWire),
		path: resolvedPath,
		breadcrumbs,
		items,
		activeUnit,
		review,
		hasMore,
		nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
		total,
		viewerId: clamp(actor.userId, 80),
		// An isolated viewer is looking at their own deliverables, so the Review action is not theirs to
		// have — mirroring the fixture read, and consistent with {@link resolveIsolation}.
		viewerIsClient: isolate ? false : viewerIsReviewer,
		// The Part 3 override: one provider across the whole scope, or a viewer who only ever sees
		// themselves. `everyStageCollapsed` carries the case of a scope with several stages that each
		// resolve to one person — the submitter level is absent from the tree either way, and this flag
		// is what tells the explorer so.
		singleFreelancer: isolate ||
			(everyStageCollapsed && allSubmitters.size <= 1 && allProviders.size <= 1),
	};
}

// #endregion
