import type { ReadActor } from "../read-actor.ts";
import { clamp, clampOr, commsDb, filesDb } from "./live-support.ts";
import {
	memoAudioOf,
	type MessageAttachment,
	type MessageAttachmentKind,
	type MessageAudio,
} from "@projective/types/projects";
import { MEMO_PEAKS_MAX } from "@projective/types/messaging";
import {
	assetIdOf,
	describeFile,
	type FileKind,
	imagePlaceholderOf,
	mediaDimensionsOf,
	mediaProxyHref,
} from "@projective/types/files";
import { metadataOf } from "../files/asset-row.ts";

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
 * A stored asset (`source = 'supabase'`, `status = 'uploaded'`) streams through the media proxy
 * (`mediaProxyHref`, Decision #162(A)), which re-checks the read under the viewer's session; no storage
 * host or path reaches the page, and the address is stable, so it is safe in server-rendered HTML. An
 * image asks for the `md` rendition (the proxy serves the original when the pipeline wrote none). A link
 * asset keeps its own target and a mounted connector file its provider page; anything else has no
 * address and renders as a named file tile. The tile also carries the file's own id (`assetId`), its
 * MIME type, and the dimensions and BlurHash read at upload, so a bubble lays out before the bytes land.
 *
 * ## A voice memo is a player, not a tile
 *
 * A memo is uploaded as an ordinary file, and `comms.send_message` writes its length and envelope on
 * that file's link row (`audio_duration_ms`, `audio_peaks`; CAS M18). Such a row becomes the message's
 * `audio` and leaves the tile list, so a reload draws the same player the send's echo drew rather than
 * a bare `voice-message-….webm` tile. A memo whose file has no servable address stays a tile: a player
 * over a track that cannot load would be a control that does nothing.
 */

// #region Limits
/** `MessageAttachment.name` is `max(200)`. */
const NAME_MAX = 200;
/** `MessageAttachment.ext` is `max(12)`. */
const EXT_MAX = 12;
/** `MessageAttachment.url` is `max(600)`. */
const URL_MAX = 600;
/** `MessageAttachment.mimeType` is `max(255)`. */
const MIME_MAX = 255;
// #endregion

// #region Row shapes
/** One `comms.message_attachments` link row. */
interface AttachmentLinkRow {
	id: string;
	message_id: string;
	attachment_id: string;
	/** `copy` or `link` (Decision #401); anything else reads as a copy. */
	mode?: string | null;
	created_at: string;
	/** The memo's length, set only on the one link row that is the message's voice memo. */
	audio_duration_ms?: number | null;
	/** The memo's envelope (`real[]`), set together with {@link audio_duration_ms}. */
	audio_peaks?: unknown;
}

/** What one message carries: its file tiles, and its voice memo when it has one. */
export interface MessageMedia {
	attachments: MessageAttachment[];
	audio: MessageAudio | null;
}

/** A message with no files. */
export const NO_MEDIA: MessageMedia = Object.freeze({
	attachments: [],
	audio: null,
}) as MessageMedia;

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
	"metadata",
	"size_bytes",
].join(", ");

/** One `files.items` row as selected by {@link FILE_COLUMNS}. */
export interface FileRow {
	id: string;
	display_name: string | null;
	original_name: string | null;
	mime_type: string | null;
	source: string | null;
	status: string | null;
	link_url: string | null;
	external_web_url: string | null;
	/** The upload-time extraction envelope; parsed by `metadataOf`. */
	metadata: unknown;
	/** `bigint`, so PostgREST may answer a string; absent on rows read before the column was asked. */
	size_bytes?: number | string | null;
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
		return mediaProxyHref(file.id, kind === "image" ? { tier: "md" } : {});
	}
	return clamp(file.link_url ?? file.external_web_url, URL_MAX);
}

/** The intrinsic size and placeholder the upload-time extraction read, when it read them. */
function mediaOf(
	file: FileRow,
): { width: number | null; height: number | null; blurhash: string | null } {
	const metadata = metadataOf(file.metadata);
	const dims = mediaDimensionsOf(metadata);
	return {
		width: dims?.width ?? null,
		height: dims?.height ?? null,
		blurhash: imagePlaceholderOf(metadata)?.blurhash ?? null,
	};
}

/**
 * Map a link row and its file onto one attachment tile — pure, so the projection is testable
 * without a database.
 */
export function toAttachment(
	link: Pick<AttachmentLinkRow, "id" | "mode">,
	file: FileRow,
): MessageAttachment {
	const name = file.display_name?.trim() || file.original_name?.trim() || "";
	const described = describeFile(file.original_name ?? name, file.mime_type ?? undefined);
	const url = urlFor(file, described.kind);
	const media = mediaOf(file);
	const mime = file.mime_type?.trim() ?? "";
	return {
		// The LINK row's id, not the file's: nothing stops one asset being attached to a message
		// twice, which would collide two Preact children on one key. The link row is unique.
		id: link.id,
		kind: attachmentKindFor(described.kind, url.length > 0),
		url,
		name: clampOr(name, NAME_MAX, "Attachment"),
		ext: clamp(described.extension, EXT_MAX),
		width: media.width,
		height: media.height,
		assetId: assetIdOf(file.id),
		mimeType: mime ? clamp(mime, MIME_MAX) : null,
		blurhash: media.blurhash,
		mode: link.mode === "link" ? "link" : "copy",
		sizeBytes: sizeOf(file.size_bytes),
	};
}

/** A stored size as a whole byte count, or `null` when the column holds nothing usable. */
function sizeOf(raw: FileRow["size_bytes"]): number | null {
	const n = typeof raw === "string" ? Number(raw) : raw;
	return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * The memo facts a link row holds, or `null` when it is not a memo or the stored facts are not ones
 * the player can draw. The table's CHECKs already bound both columns; this is the read side's own
 * guard, so a malformed row degrades to a tile instead of failing the page's schema parse.
 */
export function memoFactsOf(
	link: Pick<AttachmentLinkRow, "audio_duration_ms" | "audio_peaks">,
): { durationMs: number; peaks: number[] } | null {
	const duration = link.audio_duration_ms;
	const peaks = link.audio_peaks;
	if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 0) return null;
	if (!Array.isArray(peaks) || peaks.length > MEMO_PEAKS_MAX) return null;
	if (!peaks.every((p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1)) {
		return null;
	}
	return { durationMs: duration, peaks: peaks as number[] };
}

/**
 * Fold one message's link rows and their files into its {@link MessageMedia}, pure so the split is
 * testable without a database. Rows keep their order; a row whose file did not come back is dropped
 * (see the module note). The first memo row with a servable address is the player; every other row
 * is a tile.
 */
export function toMessageMedia(
	links: readonly Pick<
		AttachmentLinkRow,
		"id" | "mode" | "attachment_id" | "audio_duration_ms" | "audio_peaks"
	>[],
	files: ReadonlyMap<string, FileRow>,
): MessageMedia {
	const attachments: MessageAttachment[] = [];
	let audio: MessageAudio | null = null;
	for (const link of links) {
		const file = files.get(link.attachment_id);
		if (!file) continue;
		const tile = toAttachment(link, file);
		const facts = audio === null && tile.mode === "copy" ? memoFactsOf(link) : null;
		const url = facts ? urlFor(file, "audio") : "";
		if (facts && url.length > 0) {
			audio = memoAudioOf(url, facts);
			continue;
		}
		attachments.push(tile);
	}
	return { attachments, audio };
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
 * Each message's files, by message id: its tiles in the order they were attached, and its voice memo
 * as a player ({@link toMessageMedia}). A message with no readable file has no entry.
 *
 * `messageTable` must be the SCHEMA-QUALIFIED discriminator (`'comms.dm_messages'`), not the bare
 * `'dm'` that `comms.channel_files` uses for the same idea — the wrong one matches zero rows and
 * raises nothing.
 */
export async function fetchMessageAttachments(
	actor: ReadActor & { accessToken: string },
	messageTable: MessageTable,
	messageIds: readonly string[],
): Promise<Map<string, MessageMedia>> {
	const out = new Map<string, MessageMedia>();
	if (messageIds.length === 0) return out;

	const { data, error } = await commsDb(actor)
		.from("message_attachments")
		.select("id, message_id, attachment_id, mode, created_at, audio_duration_ms, audio_peaks")
		.eq("message_table", messageTable)
		.in("message_id", messageIds as string[])
		.order("created_at", { ascending: true })
		.order("id", { ascending: true });
	if (error) return out;
	const links = (data ?? []) as unknown as AttachmentLinkRow[];
	if (links.length === 0) return out;

	const files = await fetchFiles(actor, links.map((link) => link.attachment_id));
	const byMessage = new Map<string, AttachmentLinkRow[]>();
	for (const link of links) {
		const list = byMessage.get(link.message_id) ?? [];
		list.push(link);
		byMessage.set(link.message_id, list);
	}
	for (const [messageId, rows] of byMessage) {
		const media = toMessageMedia(rows, files);
		if (media.attachments.length > 0 || media.audio !== null) out.set(messageId, media);
	}
	return out;
}
// #endregion
