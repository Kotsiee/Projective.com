import { z } from "zod";
import { MessageAudioSchema } from "../projects/messages.ts";

/**
 * messaging.send — the Zod SSOT for posting ONE message into a global-inbox conversation
 * (`POST /api/messaging/messages/send`), the messaging counterpart of
 * {@link ../projects/messages.ts | SendProjectMessageSchema}.
 *
 * The two shapes are deliberately one field apart. A project channel is addressed by the pair
 * `(projectId, channelId)` because a stage room is resolved THROUGH its project; a conversation is
 * addressed by its own id alone — the unified `dm-{handle}` identity a project DM and the inbox
 * share (PRODUCT_SPEC §Unified Messaging), or the `comms.dm_threads` uuid on the live path. Reusing
 * the project schema with a dummy `projectId` would make every conversation send carry a field the
 * route has to know to ignore, which is exactly the kind of "same string in two slots" the composer's
 * own scope guard exists to catch.
 *
 * Attachments arrive as `files.items` ids, already uploaded through the files handshake — bytes never
 * transit an application route — so a library-picked attachment and a just-uploaded one are the same
 * thing on this wire. The refinement is the composer's own rule restated server-side: a message with
 * no text, no attachment and no memo is not a message, and refusing it here is what stops an empty
 * row from ever reaching a thread.
 */

// #region Send payload
export const SendConversationMessageSchema = z.object({
	/** The conversation id — a unified `dm-{handle}` / `grp-…` id, or a `comms.dm_threads` uuid. */
	conversationId: z.string().min(1).max(120),
	text: z.string().max(8000),
	/** Every attachment, device-uploaded and library-picked alike, as `files.items` ids. */
	attachmentIds: z.array(z.string().min(1).max(120)).max(20).default([]),
	/** The voice memo's persisted projection; its own bytes are one of {@link attachmentIds}. */
	audio: MessageAudioSchema.nullable().default(null),
}).refine(
	(v) => v.text.trim().length > 0 || v.attachmentIds.length > 0 || v.audio !== null,
	{ message: "Write a message, attach a file, or record a memo." },
);
export type SendConversationMessage = z.infer<typeof SendConversationMessageSchema>;
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
// #endregion
