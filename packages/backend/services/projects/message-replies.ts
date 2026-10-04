import {
	type ChatMessage,
	type MessageReply,
	type MessageReplyMedia,
	replyExcerpt,
	unavailableReply,
} from "@projective/types/projects";
import type { FieldErrors } from "../ServiceResult.ts";

/**
 * message-replies — the one place a reply's QUOTE is built and a bad reply is refused, shared by the
 * project channel and the global inbox, on the live path and the stub path alike.
 *
 * A project channel and a DM render through one bubble and one {@link MessageReply} projection, and
 * the four write/read modules that produce it (two live, two stub) would otherwise each decide for
 * themselves what a deleted original looks like, which label a text-less quote gets and which words
 * a refusal uses. Those are the decisions a reader compares across surfaces, so they are made once.
 *
 * Pure: no client, no I/O. The live modules read the rows and hand them here; the stub modules hand
 * over the fixture message they found.
 */

// #region Refusal
/**
 * The sentence every refusal of a bad `replyToId` carries.
 *
 * `comms.tg_guard_message_reply` / `tg_guard_dm_message_reply` (00001300) raise these exact words, so
 * the database's backstop and the services' own pre-check say the same thing, and `refusalFrom`
 * recognises the trigger's raise by them. ONE sentence for every cause — an id that names nothing, a
 * message in another room, a malformed id — because telling those apart would let a caller probe which
 * message ids exist in rooms they cannot read.
 */
export const REPLY_REFUSAL_MESSAGE = "That message can't be replied to here.";

/** A refused reply as a write reports it: a 422 on the `replyToId` field. */
export interface ReplyRefusal {
	status: 422;
	message: string;
	errors: FieldErrors;
}

/**
 * The refusal for a reply that does not resolve in the sender's own conversation.
 *
 * Exactly what `refusalFrom(REPLY_REFUSAL_MESSAGE, "replyToId")` produces for the trigger's raise —
 * a rule the caller can act on (send it without the quote), not a fault to retry — so a reply refused
 * by the pre-check and one refused by the trigger are indistinguishable to the composer.
 */
export function replyRefusal(): ReplyRefusal {
	return { status: 422, message: REPLY_REFUSAL_MESSAGE, errors: { replyToId: "not_allowed" } };
}
// #endregion

// #region Quote projection
/**
 * The columns of an original a quote needs, on either message table.
 *
 * `has_attachments` and `is_audio` are read HERE and nowhere else in the live read path. Both are
 * denormalised flags no trigger maintains, which is why the feeds never treat them as the truth about
 * what a bubble renders — attachments come from `comms.message_attachments`. A quote is the exception
 * that can afford them: `media` only LABELS a quote (a text-less original reads "Voice memo" or
 * "Attachment" instead of an empty line), the flags are written by the same INSERT as the body, and
 * the send schemas refuse a message with no text, no attachment and no memo — so a text-less original
 * always set one of them. Resolving the original's real attachment rows instead would be a second
 * dependent round trip per page, spent on one word.
 */
export const REPLY_ORIGINAL_COLUMNS = [
	"id",
	"sender_user_id",
	"body",
	"has_attachments",
	"is_audio",
	"deleted_at",
].join(", ");

/** An original message as {@link REPLY_ORIGINAL_COLUMNS} reads it, from either table. */
export interface ReplyOriginalRow {
	id: string;
	sender_user_id: string;
	body: string;
	has_attachments: boolean;
	is_audio: boolean;
	deleted_at: string | null;
}

/** The label a quote carries for what the original held besides text. A memo outranks a file. */
export function replyMediaOf(audio: boolean, attachments: boolean): MessageReplyMedia {
	if (audio) return "audio";
	return attachments ? "attachment" : "none";
}

/**
 * The quote for one stored original.
 *
 * A soft-deleted original is UNAVAILABLE rather than quoted: the delete removed those words from the
 * conversation, and a quote that kept rendering them would make every reply a way to read what its
 * author took back. The reply still says it answered something, so it does not read as a non-sequitur.
 * An original that did not come back at all (RLS withheld it, or it is gone) is passed as `undefined`
 * and reads the same way — the reader cannot tell the two apart, and must not be able to.
 *
 * `senderName` is the caller's already-clamped display name, so the quote and the original's own
 * bubble name the same person the same way.
 */
export function replyFromRow(
	replyToId: string,
	original: ReplyOriginalRow | undefined,
	senderName: string,
	viewerId: string,
): MessageReply {
	if (!original || original.deleted_at) return unavailableReply(replyToId);
	return {
		id: original.id,
		senderName,
		isOwn: original.sender_user_id === viewerId,
		excerpt: replyExcerpt(original.body),
		media: replyMediaOf(original.is_audio, original.has_attachments),
		available: true,
	};
}

/**
 * The quote for an already-projected original — the fixture corpus and the stub store, where the
 * original is a {@link ChatMessage} rather than a row. `null` when there is nothing a reply may
 * quote: no such message, or a system notice, which has no author to answer and has no live
 * counterpart (the schema carries no system messages, so a live reply could never point at one).
 */
export function replyFromMessage(original: ChatMessage | null | undefined): MessageReply | null {
	if (!original || original.type !== "user") return null;
	return {
		id: original.id,
		senderName: original.sender?.name ?? null,
		isOwn: original.isOwn,
		excerpt: replyExcerpt(original.text),
		media: replyMediaOf(original.audio !== null, original.attachments.length > 0),
		available: true,
	};
}
// #endregion
