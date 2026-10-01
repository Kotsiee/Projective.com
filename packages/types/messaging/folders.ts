import { z } from "zod";

/**
 * messaging.folders — the inbox folder a conversation sits in for ONE participant
 * (`comms.dm_participants.inbox_folder`), and the two rules that move it. The database holds the
 * authoritative copies (`comms.send_request_message`, `comms.fn_promote_thread_on_reply`); these
 * pure twins are what the stub path and the lane's optimistic overlay apply, so all three agree.
 */

// #region Folder
/** Primary · Requests · Archived. `archived` is a folder, not a flag beside one. */
export const InboxFolder = z.enum(["primary", "requests", "archived"]);
export type InboxFolder = z.infer<typeof InboxFolder>;

/** Every folder, in tab order. */
export const INBOX_FOLDERS: readonly InboxFolder[] = InboxFolder.options;

/** Display names for the lane's folder tabs. */
export const INBOX_FOLDER_LABELS: Record<InboxFolder, string> = {
	primary: "Primary",
	requests: "Requests",
	archived: "Archived",
};
// #endregion

// #region Write
/** `POST /api/messaging/conversations/[id]/folder` — move a conversation between the caller's folders. */
export const SetConversationFolderSchema = z.object({ folder: InboxFolder });
export type SetConversationFolder = z.infer<typeof SetConversationFolderSchema>;

/** The answer to a folder move. */
export interface ConversationFolderSet {
	id: string;
	folder: InboxFolder;
}
// #endregion

// #region Rules
/**
 * A participant's folder after a message is posted into the thread. A reply accepts a request: the
 * SENDER's own copy leaves Requests for Primary. Every other participant's folder is untouched, so a
 * requester following up can never pull the thread out of the recipient's Requests.
 */
export function folderAfterSend(folder: InboxFolder, isSender: boolean): InboxFolder {
	return isSender && folder === "requests" ? "primary" : folder;
}

/** What {@link requestRouting} needs to know about the thread a hiring request lands in. */
export interface RequestRoutingInput {
	/** The request created the thread, found it empty, or restored it from the recipient's deletion. */
	opens: boolean;
	/** The two follow each other (`org.profile_follows`, both directions). */
	mutualFollow: boolean;
}

/**
 * Where a hiring request files the thread it opens: the sender keeps it in Primary and the recipient
 * gets it in Requests unless the two follow each other. `null` when the conversation was already under
 * way — a request never re-files an existing conversation.
 */
export function requestRouting(
	input: RequestRoutingInput,
): { sender: InboxFolder; recipient: InboxFolder } | null {
	if (!input.opens) return null;
	return { sender: "primary", recipient: input.mutualFollow ? "primary" : "requests" };
}

/** Unread conversations per folder — the lane's tab indicators. */
export function folderUnreadCounts(
	list: readonly { folder: InboxFolder; unread: boolean }[],
): Record<InboxFolder, number> {
	const counts: Record<InboxFolder, number> = { primary: 0, requests: 0, archived: 0 };
	for (const c of list) if (c.unread) counts[c.folder] += 1;
	return counts;
}
// #endregion
