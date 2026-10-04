import type { ReadActor } from "../read-actor.ts";
import { clamp, clampOr, commsDb, filesDb } from "./live-support.ts";
import type { MessageAttachment, MessageAttachmentKind } from "@projective/types/projects";
import { describeFile, type FileKind, fileObjectHref } from "@projective/types/files";

/**
 * message-attachments — the files behind a page of chat messages, for BOTH message tables.
 *
 * One implementation for a project channel and a global-inbox conversation, because the two read the
 * same polymorphic link table and render through the same bubble. It used to live inside the project
 * feed's read alone, and the DM read never loaded attachments at all — every file sent in a
 * conversation reached storage and `comms.message_attachments` and then rendered as nothing.
 *
 * ## Two queries, not one
 *
 * `comms.message_attachments.message_id` carries no foreign key (Postgres cannot point one column at
 * two parent tables), so PostgREST cannot embed `files.items` through it. The link rows are read
 * first, then the file rows by id. Both reads are SECONDARY — a failure costs the tiles on a page that
 * otherwise resolved, never the page — so neither throws.
 *
 * ## Who can read the file
 *
 * A chat upload lands in the SENDER's own library (private, owned by them). The person it was sent to
 * reads it through `files.fn_can_read`'s message branch — "a file attached to a message you can read"
 * — so the file row comes back under the reader's own session, with no service-role read here. A link
 * whose file still does not come back (soft-deleted, or genuinely not readable) is DROPPED rather than
 * drawn from invented metadata: a nameless tile that opens nothing tells the reader less than its
 * absence does.
 *
 * ## Where the bytes come from
 *
 * A stored asset (`source = 'supabase'`, `status = 'uploaded'`) is addressed through the private-object
 * route (`fileObjectHref`), which re-checks the read under the viewer's session and redirects to a
 * short-lived signed URL. That route is the STABLE address, so it is safe in server-rendered HTML in a
 * way a signed URL is not. An image asks for the `md` rendition (the route serves the original when the
 * pipeline wrote none). A link asset keeps its own target and a mounted connector file its provider
 * page; anything else has no address and renders as a named file tile.
 */

// #region Limits
/** `MessageAttachment.name` is `max(200)`. */
const NAME_MAX = 200;
/** `MessageAttachment.ext` is `max(12)`. */
const EXT_MAX = 12;
/** `MessageAttachment.url` is `max(600)`. */
const URL_MAX = 600;
// #endregion

// #region Row shapes
/** One `comms.message_attachments` link row. */
interface AttachmentLinkRow {
	id: string;
	message_id: string;
	attachment_id: string;
	created_at: string;
}

/** The `files.items` columns a tile needs. */
const FILE_COLUMNS = [
	"id",
	"display_name",
	"original_name",
	"mime_type",
	"source",
	"status",
	"link_url",
	"external_web_url",
].join(", ");

/** One `files.items` row as selected by {@link FILE_COLUMNS}. */
interface FileRow {
	id: string;
	display_name: string | null;
	original_name: string | null;
	mime_type: string | null;
	source: string | null;
	status: string | null;
	link_url: string | null;
	external_web_url: string | null;
}

/** The polymorphic discriminators `comms.message_attachments.message_table` accepts. */
export type MessageTable = "comms.project_messages" | "comms.dm_messages";
// #endregion

// #region Mapping
/**
 * The rendering bucket a file maps onto, narrowed from the nine-member {@link FileKind} to the four
 * `MessageAttachmentKind` a bubble can draw. A visual kind with no servable URL is DOWNGRADED to
 * `file`: `MessageMedia` puts `att.url` straight into `<img src>`, and an empty one re-requests the
 * document and paints a broken tile.
 */
function attachmentKindFor(kind: FileKind, servable: boolean): MessageAttachmentKind {
	if (kind === "pdf") return "pdf";
	if (servable && (kind === "image" || kind === "video")) return kind;
	return "file";
}

/** The address a tile opens, or `""` when the asset has none. */
function urlFor(file: FileRow, kind: FileKind): string {
	if (file.source === "supabase") {
		if (file.status !== "uploaded") return "";
		return fileObjectHref(file.id, kind === "image" ? { tier: "md" } : {});
	}
	return clamp(file.link_url ?? file.external_web_url, URL_MAX);
}

/** Map a link row and its file onto one attachment tile. */
function toAttachment(link: AttachmentLinkRow, file: FileRow): MessageAttachment {
	const name = file.display_name?.trim() || file.original_name?.trim() || "";
	const described = describeFile(file.original_name ?? name, file.mime_type ?? undefined);
	const url = urlFor(file, described.kind);
	return {
		// The LINK row's id, not the file's: nothing stops one asset being attached to a message
		// twice, which would collide two Preact children on one key. The link row is unique.
		id: link.id,
		kind: attachmentKindFor(described.kind, url.length > 0),
		url,
		name: clampOr(name, NAME_MAX, "Attachment"),
		ext: clamp(described.extension, EXT_MAX),
		// No intrinsic dimension columns exist on `files.items`; the bubble lays images out by tile.
		width: null,
		height: null,
	};
}
// #endregion

// #region Read
/** The `files.items` rows behind a set of ids, read under the caller's own session. */
async function fetchFiles(
	actor: ReadActor & { accessToken: string },
	fileIds: readonly string[],
): Promise<Map<string, FileRow>> {
	const out = new Map<string, FileRow>();
	const unique = [...new Set(fileIds)].filter((id) => id.length > 0);
	if (unique.length === 0) return out;
	const { data, error } = await filesDb(actor)
		.from("items")
		.select(FILE_COLUMNS)
		.in("id", unique)
		// Explicit, even though `files.fn_can_read` already refuses a soft-deleted row: the policy is
		// the security gate and this is the meaning gate.
		.is("deleted_at", null);
	if (error) return out;
	for (const row of (data ?? []) as unknown as FileRow[]) out.set(row.id, row);
	return out;
}

/**
 * Attachments per message id, in the order they were attached.
 *
 * `messageTable` must be the SCHEMA-QUALIFIED discriminator (`'comms.dm_messages'`), not the bare
 * `'dm'` that `comms.channel_files` uses for the same idea — the wrong one matches zero rows and
 * raises nothing.
 */
export async function fetchMessageAttachments(
	actor: ReadActor & { accessToken: string },
	messageTable: MessageTable,
	messageIds: readonly string[],
): Promise<Map<string, MessageAttachment[]>> {
	const out = new Map<string, MessageAttachment[]>();
	if (messageIds.length === 0) return out;

	const { data, error } = await commsDb(actor)
		.from("message_attachments")
		.select("id, message_id, attachment_id, created_at")
		.eq("message_table", messageTable)
		.in("message_id", messageIds as string[])
		.order("created_at", { ascending: true })
		.order("id", { ascending: true });
	if (error) return out;
	const links = (data ?? []) as unknown as AttachmentLinkRow[];
	if (links.length === 0) return out;

	const files = await fetchFiles(actor, links.map((link) => link.attachment_id));
	for (const link of links) {
		const file = files.get(link.attachment_id);
		if (!file) continue;
		const list = out.get(link.message_id) ?? [];
		list.push(toAttachment(link, file));
		out.set(link.message_id, list);
	}
	return out;
}
// #endregion
