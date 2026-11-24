import { z } from "zod";
import { MessageDeltaSchema, messageDeltaText } from "../projects/message-rich.ts";
import type { ChatMessage, MessageEditRules } from "../projects/messages.ts";
import { type ChatRef, projectChatRef, threadChatRef } from "./send.ts";

/**
 * messaging.message-edits — editing and deleting a sent message (PROJECTS CH1; CAS M11). The owner's
 * rule (2026-11-24): the author edits within {@link MESSAGE_EDIT_WINDOW_MINUTES} of sending, any
 * number of times, and deletes for everyone at any time; nothing in an archived room, or in a room a
 * live dispute freezes, changes. Every replaced text is kept in `comms.message_revisions`, which no
 * client reads.
 *
 * Authority is the SQL doors' (`comms.edit_message`, `comms.delete_message`). What lives here is the
 * pure half the client and the fixture backend share — {@link messageEditOffer}, which decides what a
 * bubble offers and what the stub refuses — the two wire shapes the route parses, the door's answer,
 * and the row mirror of `comms.message_revisions` (held to the migration by
 * `message-edits.contract.test.ts`, as is the window to its seeded dial).
 */

// #region The rule
/** `security.platform_params.message_edit_window_minutes` as seeded (00005001); the doors' fallback. */
export const MESSAGE_EDIT_WINDOW_MINUTES = 15;

/** The rules a surface that has not read the room's assumes: the seeded window, not frozen. */
export const DEFAULT_MESSAGE_EDIT_RULES: MessageEditRules = {
	windowMinutes: MESSAGE_EDIT_WINDOW_MINUTES,
	frozen: null,
};

/** Why an edit or a delete is not offered, or would be refused — the doors' SQLSTATEs by name. */
export type MessageEditRefusal =
	| "not_own" // 42501
	| "system" // a system notice is nobody's message
	| "deleted" // PM409
	| "quote" // PM409: a quote card records a quote move (Decision #522)
	| "window" // PM410 (edit only)
	| "frozen"; // PM423

/** The message fields the rule reads. */
export type EditableMessage = Pick<ChatMessage, "type" | "isOwn" | "createdAt"> & {
	deleted?: boolean;
	quoteEventId?: string | null;
};

/** The instant the author's edit window closes, in epoch ms (NaN for an unreadable `createdAt`). */
export function editClosesAt(
	message: Pick<ChatMessage, "createdAt">,
	rules: MessageEditRules,
): number {
	return Date.parse(message.createdAt) + rules.windowMinutes * 60_000;
}

/**
 * What the viewer may do to a message now, with the reason for each "no". The order of the checks is
 * the doors' (`comms.fn_message_for_change`, then the window), so the stub refuses with the reason
 * the live door would raise first.
 */
export function messageEditOffer(
	message: EditableMessage,
	rules: MessageEditRules,
	nowMs: number,
): {
	edit: MessageEditRefusal | null;
	delete: MessageEditRefusal | null;
} {
	const shared: MessageEditRefusal | null = message.type !== "user"
		? "system"
		: !message.isOwn
		? "not_own"
		: message.deleted
		? "deleted"
		: message.quoteEventId
		? "quote"
		: rules.frozen
		? "frozen"
		: null;
	if (shared) return { edit: shared, delete: shared };
	const open = nowMs <= editClosesAt(message, rules);
	return { edit: open ? null : "window", delete: null };
}

/** The sentence a refusal reads, the doors' own words. */
export function messageEditRefusalText(
	refusal: MessageEditRefusal,
	rules: MessageEditRules,
): string {
	switch (refusal) {
		case "not_own":
			return "Only the person who sent a message can change it.";
		case "system":
			return "This notice can't be changed.";
		case "deleted":
			return "This message was deleted.";
		case "quote":
			return "A quote card records the quote as it was sent, so it cannot be changed.";
		case "window":
			return `A message can be edited for ${rules.windowMinutes} minutes after it is sent.`;
		case "frozen":
			return rules.frozen === "dispute"
				? "A dispute is open on this work, so these messages stay as they are until it closes."
				: "This conversation is archived, so its messages can no longer change.";
	}
}

/**
 * A deleted message as every reader sees it: its place, author and time, and nothing it said. Used by
 * every read (live and fixture) so a tombstone is the same bubble wherever it is drawn.
 */
export function tombstoneOf(message: ChatMessage): ChatMessage {
	return {
		...message,
		text: "",
		delta: null,
		replyTo: null,
		attachments: [],
		audio: null,
		reactions: [],
		pinned: false,
		quoteEventId: null,
		deleted: true,
	};
}
// #endregion

// #region Wire
/**
 * The chat a message is in, named as its send names it: an inbox conversation by its id (the
 * `/api/messaging/messages/send` wire, `threadChatRef`), or a project chat by its project and channel
 * (`/api/projects/messages/send`, `projectChatRef`). Exactly one of the two forms.
 */
const chatFields = {
	conversationId: z.string().min(1).max(120).optional(),
	projectId: z.string().min(1).max(120).optional(),
	channelId: z.string().min(1).max(120).optional(),
};

type ChatFields = { conversationId?: string; projectId?: string; channelId?: string };

function namesOneChat(v: ChatFields): boolean {
	return v.conversationId !== undefined
		? v.projectId === undefined && v.channelId === undefined
		: v.projectId !== undefined && v.channelId !== undefined;
}

const ONE_CHAT = {
	message: "Name the conversation, or the project and its channel.",
	path: ["form"],
};

/** The {@link ChatRef} a parsed edit or delete names. */
export function messageChatRef(v: ChatFields): ChatRef {
	return v.conversationId !== undefined
		? threadChatRef(v.conversationId)
		: projectChatRef(v.projectId ?? "", v.channelId ?? "");
}

/**
 * `PATCH /api/messages/[id]` — the new words and their formatting. The Delta must spell `text`
 * exactly, as on a send; an empty edit is refused (delete the message instead).
 */
export const EditMessageSchema = z.object({
	...chatFields,
	text: z.string().max(8000).refine((t) => t.trim().length > 0, {
		message: "A message needs words. To take it back, delete it instead.",
	}),
	delta: MessageDeltaSchema.nullable().default(null),
}).refine(namesOneChat, ONE_CHAT).refine(
	(v) => v.delta === null || messageDeltaText(v.delta) === v.text,
	{ message: "The formatting does not match the text.", path: ["delta"] },
);
export type EditMessage = z.infer<typeof EditMessageSchema>;

/** `DELETE /api/messages/[id]` — delete for everyone. */
export const DeleteMessageSchema = z.object(chatFields).refine(namesOneChat, ONE_CHAT);
export type DeleteMessage = z.infer<typeof DeleteMessageSchema>;

/** What either door answers: the message's changeable state after the write. */
export const MessageChangeSchema = z.object({
	id: z.string().min(1).max(80),
	text: z.string().max(8000),
	delta: MessageDeltaSchema.nullable(),
	editedAt: z.string().nullable(),
	deleted: z.boolean(),
});
export type MessageChange = z.infer<typeof MessageChangeSchema>;

/** Apply a door's answer to the message a feed holds. */
export function applyMessageChange(message: ChatMessage, change: MessageChange): ChatMessage {
	if (change.deleted) return tombstoneOf(message);
	return { ...message, text: change.text, delta: change.delta, editedAt: change.editedAt };
}
// #endregion

// #region comms.message_revisions
/** `message_revisions.message_table`. */
export const MessageRevisionTable = z.enum(["comms.project_messages", "comms.dm_messages"]);

/** `message_revisions.action`: what replaced the revision's text. */
export const MessageRevisionAction = z.enum(["edit", "delete"]);
export type MessageRevisionAction = z.infer<typeof MessageRevisionAction>;

/**
 * One `comms.message_revisions` row: a text a message stopped showing. Evidence only — no client
 * reads it; the dispute vault and `comms.get_message_revisions` (operators) do.
 */
export const MessageRevisionRowSchema = z.object({
	id: z.string().uuid(),
	messageTable: MessageRevisionTable,
	messageId: z.string().uuid(),
	action: MessageRevisionAction,
	body: z.string(),
	bodyDelta: z.record(z.string(), z.unknown()).nullable(),
	piiMasked: z.boolean(),
	authoredAt: z.string(),
	revisedAt: z.string(),
	revisedBy: z.string().uuid(),
});
export type MessageRevisionRow = z.infer<typeof MessageRevisionRowSchema>;
// #endregion
