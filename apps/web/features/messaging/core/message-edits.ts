import { apiFetch } from "@web/utils/api-client.ts";
import { type MessageChange, MessageChangeSchema } from "@projective/types/messaging";
import type { MessageDelta } from "@projective/types/projects";

/**
 * The client half of editing and deleting a sent message (PROJECTS CH1): `PATCH` and `DELETE` on
 * `/api/messages/[id]`, naming the chat the message is in as its send does (an inbox
 * `conversationId`, or a project chat's `projectId` + `channelId`). Not optimistic: the door can
 * refuse for reasons the feed cannot see (the window, a dispute raised a moment ago), and an edit is
 * re-masked on the way in, so the feed draws what the door answers rather than what was typed.
 */

/** The chat a message lives in, as its send names it: an inbox conversation, or a project chat. */
export type MessageChat = { conversationId: string } | { projectId: string; channelId: string };

/** A door's answer: the message as it now reads, or the sentence it refused with. */
export type MessageChangeOutcome =
	| { ok: true; change: MessageChange; message: string }
	| { ok: false; message: string };

const EDIT_FAILED = "That edit didn't save. Try again.";
const DELETE_FAILED = "That message wasn't deleted. Try again.";

async function send(
	id: string,
	method: "PATCH" | "DELETE",
	body: Record<string, unknown>,
	failed: string,
): Promise<MessageChangeOutcome> {
	try {
		const res = await apiFetch(`/api/messages/${encodeURIComponent(id)}`, {
			method,
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body),
		});
		const json = await res.json().catch(() => null) as
			| { message?: string; change?: unknown }
			| null;
		const parsed = MessageChangeSchema.safeParse(json?.change);
		if (!res.ok || !parsed.success) return { ok: false, message: json?.message || failed };
		return { ok: true, change: parsed.data, message: json?.message ?? "" };
	} catch {
		return { ok: false, message: failed };
	}
}

/** Edit a message's words (and their formatting, which must spell them). */
export function editMessage(
	id: string,
	chat: MessageChat,
	text: string,
	delta: MessageDelta | null,
): Promise<MessageChangeOutcome> {
	return send(id, "PATCH", { ...chat, text, delta }, EDIT_FAILED);
}

/** Delete a message for everyone. */
export function deleteMessage(id: string, chat: MessageChat): Promise<MessageChangeOutcome> {
	return send(id, "DELETE", { ...chat }, DELETE_FAILED);
}
