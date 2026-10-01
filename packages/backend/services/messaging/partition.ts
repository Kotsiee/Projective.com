import type { ConversationListParams, ConversationSummary } from "@projective/types/messaging";

/**
 * Whether a conversation sits in the requested folder and partition — the one predicate the corpus
 * page, the created-conversation overlay and the live row set all partition by, so no two of them
 * can disagree about which list a conversation belongs in.
 */
export function inPartition(c: ConversationSummary, params: ConversationListParams): boolean {
	if (params.folder && c.folder !== params.folder) return false;
	if (params.view === "archived") return c.archived;
	if (params.view === "starred") return c.starred && !c.archived;
	if (params.view === "inbox") return !c.archived;
	return true;
}
