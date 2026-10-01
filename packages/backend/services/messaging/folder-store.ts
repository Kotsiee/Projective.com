import {
	type ConversationSummary,
	folderAfterSend,
	type InboxFolder,
} from "@projective/types/messaging";

/**
 * messaging folder store — the PER-PROCESS overlay of inbox folders while `MESSAGING_BACKEND_LIVE`
 * is off: a folder the viewer chose (Archive, Move to Requests) and a request the viewer answered by
 * replying (the reply-promotion rule, `folderAfterSend`). Keyed by owner AND conversation, because a
 * folder is per participant — it is the stub twin of `comms.dm_participants.inbox_folder`. Not a
 * database; a restart forgets it, like every sibling store.
 */

const folders = new Map<string, InboxFolder>();

const keyOf = (owner: string, conversationId: string) => `${owner}\u0000${conversationId}`;

/** Record the viewer's folder for a conversation. */
export function setStubFolder(owner: string, conversationId: string, folder: InboxFolder): void {
	folders.set(keyOf(owner, conversationId), folder);
}

/** The viewer's stored folder for a conversation, or null when the corpus value stands. */
export function stubFolderOf(owner: string, conversationId: string): InboxFolder | null {
	return folders.get(keyOf(owner, conversationId)) ?? null;
}

/** A summary with the viewer's stored folder applied (and `archived` kept in step with it). */
export function withStubFolder(owner: string, summary: ConversationSummary): ConversationSummary {
	const folder = stubFolderOf(owner, summary.id);
	if (!folder || folder === summary.folder) return summary;
	return { ...summary, folder, archived: folder === "archived" };
}

/** Apply the reply-promotion rule after the viewer sent into a conversation currently in `folder`. */
export function promoteStubOnSend(
	owner: string,
	conversationId: string,
	folder: InboxFolder,
): InboxFolder {
	const next = folderAfterSend(folder, true);
	if (next !== folder) setStubFolder(owner, conversationId, next);
	return next;
}

/** Forget every stored folder (tests). */
export function clearStubFolders(): void {
	folders.clear();
}
