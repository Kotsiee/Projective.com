import {
	applyMessageChange,
	DEFAULT_MESSAGE_EDIT_RULES,
	type MessageChange,
} from "@projective/types/messaging";
import type { ChatMessage, MessagePage } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { writeOwnerOf } from "./write-store.ts";

/**
 * messaging edit store — the fixture backend's record of the edits and deletes this viewer made
 * (PROJECTS CH1) while the live gates are off: the stub twin of `comms.edit_message` /
 * `comms.delete_message` writing the message row. It follows the write stores' rules — per process,
 * an overlay folded over a freshly derived page, scoped by owner — and holds the door's answer
 * itself ({@link MessageChange}), so a reload draws exactly the bubble the write returned. Revisions
 * are not kept: no fixture surface reads them, as no client reads `comms.message_revisions`.
 */

// #region Store
/** The latest change per message, per owner. */
const changes = new Map<string, Map<string, MessageChange>>();

/** Record what an edit or delete left the message as. */
export function recordStubMessageChange(actor: ReadActor, change: MessageChange): void {
	const owner = writeOwnerOf(actor);
	const bucket = changes.get(owner) ?? new Map<string, MessageChange>();
	bucket.set(change.id, change);
	changes.set(owner, bucket);
}

/** A message as this viewer last left it (or as it is, when they never changed it). */
export function withStubMessageChange(actor: ReadActor, message: ChatMessage): ChatMessage {
	const change = changes.get(writeOwnerOf(actor))?.get(message.id);
	return change ? applyMessageChange(message, change) : message;
}

/**
 * A fixture page with this viewer's changes folded in, and the rules the fixture rooms carry: the
 * seeded window, never frozen (the Dev Context Switcher's `chatEdits` axis simulates a freeze).
 */
export function overlayStubMessageChanges(page: MessagePage, actor: ReadActor): MessagePage {
	const bucket = changes.get(writeOwnerOf(actor));
	const fold = (m: ChatMessage) => {
		const change = bucket?.get(m.id);
		return change ? applyMessageChange(m, change) : m;
	};
	return {
		...page,
		messages: bucket ? page.messages.map(fold) : page.messages,
		pinned: bucket ? page.pinned.map(fold).filter((m) => !m.deleted) : page.pinned,
		permissions: {
			...page.permissions,
			edits: page.permissions.edits ?? DEFAULT_MESSAGE_EDIT_RULES,
		},
	};
}

/** Forget every change (tests). */
export function resetStubMessageChanges(): void {
	changes.clear();
}
// #endregion
