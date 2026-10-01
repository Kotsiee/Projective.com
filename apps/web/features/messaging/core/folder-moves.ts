import { signal } from "@preact/signals";
import type { ConversationSummary, InboxFolder } from "../types/messaging-types.ts";
import { MessagingService } from "./MessagingService.ts";

/**
 * folder-moves — the optimistic folder overlay the inbox lane and the phone inbox share. A move lands
 * on screen at once, is confirmed by `POST /api/messaging/conversations/[id]/folder`, and is rolled
 * back with the server's reason when refused.
 */

/** Folder moves this tab has made, keyed by conversation id, layered over the loaded rows. */
export const folderOverrides = signal<Record<string, InboxFolder>>({});

/** The row with this tab's folder move applied. */
export function withFolder(
	c: ConversationSummary,
	overrides: Record<string, InboxFolder>,
): ConversationSummary {
	const folder = overrides[c.id];
	return folder && folder !== c.folder ? { ...c, folder, archived: folder === "archived" } : c;
}

/** Move a conversation out of `from` into `to`; resolves to the refusal message, or null once saved. */
export async function moveConversation(
	id: string,
	from: InboxFolder,
	to: InboxFolder,
): Promise<string | null> {
	folderOverrides.value = { ...folderOverrides.value, [id]: to };
	const res = await MessagingService.setFolder(id, to);
	if (res.ok) return null;
	folderOverrides.value = { ...folderOverrides.value, [id]: from };
	return res.message ?? "Couldn't move that conversation.";
}
