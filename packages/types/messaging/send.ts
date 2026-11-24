import { z } from "zod";
import {
	MessageFileIdsSchema,
	sendAudioAgrees,
	SendAudioSchema,
	sendDeltaAgrees,
	sendFilesAgree,
} from "../projects/messages.ts";
import { MessageDeltaSchema } from "../projects/message-rich.ts";
import type { ChatMessage } from "../projects/messages.ts";
import { isSlug, slugPattern } from "../slugs/slug.ts";

/**
 * messaging.send — the Zod SSOT for posting ONE message, wherever it is posted: the address every
 * conversation surface shares ({@link ChatRefSchema}), the message itself
 * ({@link SendMessageInputSchema}), and the two wire shapes the send routes parse — the inbox's
 * `POST /api/messaging/messages/send` ({@link SendConversationMessageSchema}) and the project chat's
 * `POST /api/projects/messages/send` (`SendProjectMessageSchema`, mapped onto a ChatRef by
 * {@link projectChatRef}). Both routes hand the one door, `MessagingBackendService.sendMessage(actor,
 * ref, input)`, a ChatRef and the same input (Decision #339, ruling N1).
 *
 * A conversation is addressed by its own id alone: its `cht-…` ref, or — for a pair nobody has
 * written in yet — the unified `dm-{handle}` that names the person, whose first message creates the
 * thread. A project room is addressed through its project, because a stage room is resolved THROUGH
 * it. The fixture backend keeps its own conversation ids (`dm-{handle}`, `grp-…`, `ch-…`).
 *
 * Attachments arrive as `files.items` ids, already uploaded through the files handshake — bytes never
 * transit an application route — so a library-picked attachment and a just-uploaded one are the same
 * thing on this wire. The refinement is the composer's own rule restated server-side: a message with
 * no text, no attachment and no memo is not a message, and refusing it here is what stops an empty
 * row from ever reaching a thread.
 */

// #region Chat addresses
/** A conversation's opaque `cht-` address (`comms.dm_threads.ref`, Decision #339 ruling N1). */
export const ThreadRefSchema = z.string().regex(
	slugPattern("thread"),
	"Expected a thread address.",
);
export type ThreadRef = z.infer<typeof ThreadRefSchema>;

/** The stage or project a project room is resolved through: a `stg-` or a `prj-` address. */
export const RoomRefSchema = z.union([
	z.string().regex(slugPattern("stage")),
	z.string().regex(slugPattern("project")),
], { error: "Expected a stage or project address." });
export type RoomRef = z.infer<typeof RoomRefSchema>;

/**
 * One address for every conversation surface (CAS §6.1, Decision #339 ruling N1). A `thread` is a
 * `comms.dm_threads` row (dm · group · service_inquiry · entity_channel) by its `cht-` ref; a `room`
 * is a `comms.project_channels` room, resolved through its stage or project, with `channel` the room
 * key `/api/projects/messages/send` takes as `channelId`. The two message stores stay separate; this
 * is what the one send door dispatches on.
 *
 * A thread opened inside a project (`/projects/prj-…/cht-…`) carries that project as `project`, and
 * the door stamps the message with it (`comms.dm_messages.project_id`) so the project's Private
 * Messages group draws the thread the inbox opens. `comms.tg_bind_dm_project` keeps the stamp only
 * when the sender and every other participant are parties to that project.
 */
export const ChatRefSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("thread"),
		ref: ThreadRefSchema,
		project: z.string().regex(slugPattern("project")).optional(),
	}),
	z.object({ kind: z.literal("room"), ref: RoomRefSchema, channel: z.string().min(1).max(120) }),
]);
export type ChatRef = z.infer<typeof ChatRefSchema>;

/**
 * The address a conversation-scope send names, as the door takes it: a {@link ChatRef} thread whose
 * `ref` is the conversation's `cht-` address — or, for a pair with no thread yet, the `dm-{handle}`
 * whose first message creates it — and, on the fixture backend, the fixture's own id.
 */
export function threadChatRef(conversationId: string): Extract<ChatRef, { kind: "thread" }> {
	return { kind: "thread", ref: conversationId };
}

/**
 * The ChatRef a project chat send names (`POST /api/projects/messages/send`): a `cht-` channel
 * segment is a thread seen through its project (`/projects/prj-…/cht-…`, Decision #339 ruling N1),
 * anything else (`discussion`, a `stg-…`, a team room, a fixture DM) a room of the project.
 */
export function projectChatRef(projectId: string, channelId: string): ChatRef {
	if (isSlug(channelId, "thread")) {
		return isSlug(projectId, "project")
			? { kind: "thread", ref: channelId, project: projectId }
			: { kind: "thread", ref: channelId };
	}
	return { kind: "room", ref: projectId, channel: channelId };
}
// #endregion

// #region Send payload
/** The fields of one message, wherever it is posted — the shape both send wires carry. */
const messageFields = {
	text: z.string().max(8000),
	/** The body's formatting; null for an unformatted send. Must spell exactly `text`. */
	delta: MessageDeltaSchema.nullable().default(null),
	/** The message this one replies to, in the same conversation; null when it is not a reply. */
	replyToId: z.string().min(1).max(80).nullable().default(null),
	/** Every attachment sent as a copy, device-uploaded and library-picked alike, as `files.items` ids. */
	attachmentIds: MessageFileIdsSchema.default([]),
	/** The sender's own files shared as a link (Decision #401), as `files.items` ids. */
	linkedFileIds: MessageFileIdsSchema.default([]),
	/** The voice memo: which of {@link attachmentIds} it is, its length and its envelope. */
	audio: SendAudioSchema.nullable().default(null),
};

/** The send rules every wire shares: a message has content, its Delta spells it, its files fit. */
function withSendRules<T extends z.ZodType<z.infer<z.ZodObject<typeof messageFields>>>>(schema: T) {
	return schema.refine(
		(v) =>
			v.text.trim().length > 0 || v.attachmentIds.length > 0 || v.linkedFileIds.length > 0 ||
			v.audio !== null,
		{ message: "Write a message, attach a file, or record a memo." },
	).refine(sendDeltaAgrees, {
		message: "The formatted body does not match the message text.",
		path: ["delta"],
	}).refine(sendFilesAgree, {
		message: "A message carries up to 20 files, each sent once.",
		path: ["linkedFileIds"],
	}).refine(sendAudioAgrees, {
		message: "The voice memo must be one of this message's own uploads.",
		path: ["audio"],
	});
}

/** The message the one send door posts, with no address: the door takes that as a {@link ChatRef}. */
export const SendMessageInputSchema = withSendRules(z.object(messageFields));
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

/**
 * `POST /api/messaging/messages/send` — the composer's conversation-scope wire: the message and the
 * conversation it is posted into (see {@link threadChatRef}).
 */
export const SendConversationMessageSchema = withSendRules(z.object({
	/** The conversation's `cht-` ref, a `dm-{handle}` with no thread yet, or a fixture id. */
	conversationId: z.string().min(1).max(120),
	...messageFields,
}));
export type SendConversationMessage = z.infer<typeof SendConversationMessageSchema>;

/** A wire payload's message, without its address. */
export function sendInputOf(payload: SendMessageInput): SendMessageInput {
	return {
		text: payload.text,
		delta: payload.delta,
		replyToId: payload.replyToId,
		attachmentIds: payload.attachmentIds,
		linkedFileIds: payload.linkedFileIds,
		audio: payload.audio,
	};
}

/**
 * What the one send door answers: the stored row, and — for a thread — the conversation's `cht-`
 * address, so a page opened on `/messages/dm-<handle>` can move to the thread its first message
 * created (`history.replaceState`). Absent for a room, and on the fixture backend.
 */
export interface SentMessage {
	message: ChatMessage;
	ref?: ThreadRef;
}
// #endregion

// #region Identity helpers
/** The unified-inbox id of a DM with a `@handle` (`dm-{handle}`, sans the `@`). */
export function dmConversationId(handle: string): string {
	return `dm-${handle.replace(/^@/, "")}`;
}

/**
 * The bare `@handle` a unified DM id addresses, or `null` for a group / uuid conversation.
 *
 * The inverse of {@link dmConversationId}, in one place: the live send path resolves the
 * counterparty's user id from this, and a second regex at the call site is how `dm-` comes to be
 * stripped from a group id that happens to start with the same letters.
 */
export function dmHandleOf(conversationId: string): string | null {
	if (!conversationId.startsWith("dm-")) return null;
	const handle = conversationId.slice(3);
	return handle.length > 0 ? handle : null;
}

/**
 * The inbox route of a conversation, `/messages/{address}`, optionally landing on one message
 * (`?m=`). `address` is the conversation's `cht-` ref or a `dm-{handle}`; a uuid does not route
 * (Decision #88), so the server-side link builders all go through here.
 */
export function conversationPath(address: string, messageId?: string): string {
	const base = `/messages/${encodeURIComponent(address)}`;
	return messageId ? `${base}?m=${encodeURIComponent(messageId)}` : base;
}
// #endregion
