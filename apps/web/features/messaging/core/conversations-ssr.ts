import type { UserContext } from "@projective/types/auth";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { FileListPage, MemberRosterPage } from "@projective/types/projects";
import type {
	ConversationDetail,
	ConversationListPage,
	MessagePage,
	MessagingRole,
	MessagingSettings,
} from "../types/messaging-types.ts";
import { defaultMessagingRole } from "./conversation-model.ts";

/**
 * conversations-ssr — the SERVER-ONLY bootstrap the `/messages` routes use to paint their first byte
 * straight from the fat {@link MessagingBackendService} (no HTTP hop — exactly as the projects
 * feed/detail SSR their first paint). Never imported by an island (it reaches `@server/services`); the
 * islands refine/paginate via the thin {@link MessagingService}.
 */

/** Everything the sidebar island needs to paint the conversation list without a client round-trip. */
export interface ConversationListBootstrap {
	page: ConversationListPage;
	role: MessagingRole;
}

/** Resolve the initial conversation-list page for the inbox sidebar (SSR first paint). */
export function resolveConversationList(context: UserContext): ConversationListBootstrap {
	const role = defaultMessagingRole(context);
	// No `view` → the full non-empty set; the sidebar overlays its local prefs + view partition client-side.
	const res = MessagingBackendService.conversations({ role });
	const page = res.ok && res.data
		? res.data.page
		: { conversations: [], hasMore: false, nextCursor: null, total: 0 };
	return { page, role };
}

/** Resolve a single conversation's metadata (the view header + Members tab), or null. */
export function resolveConversation(id: string): ConversationDetail | null {
	const res = MessagingBackendService.conversation(id);
	return res.ok && res.data ? res.data.detail : null;
}

/** Resolve the latest message page for a conversation (the Chat tab first paint). */
export function resolveConversationMessages(id: string): MessagePage | null {
	const res = MessagingBackendService.messages({ conversationId: id });
	return res.ok && res.data ? res.data.page : null;
}

/**
 * Resolve the conversation's shared-attachment page (the Files tab first paint). Returns the SAME
 * {@link FileListPage} projection the engagement File Explorer reads, so the route hands it straight to
 * the shared `FilesView` — mirrors {@link resolveFilePage}.
 */
export function resolveConversationFiles(id: string): FileListPage | null {
	const res = MessagingBackendService.files({ projectId: id, channelId: id });
	return res.ok && res.data ? res.data.page : null;
}

/**
 * Resolve the conversation's participant roster (the Members tab first paint). Returns the SAME
 * {@link MemberRosterPage} projection the engagement Members tab reads — mirrors
 * {@link resolveMemberRoster}.
 */
export function resolveConversationRoster(id: string): MemberRosterPage | null {
	const res = MessagingBackendService.members(id);
	return res.ok && res.data ? res.data.page : null;
}

/** Resolve the Message Settings projection for the acting view (settings modal first paint). */
export function resolveMessagingSettings(context: UserContext): MessagingSettings | null {
	const res = MessagingBackendService.settings(defaultMessagingRole(context));
	return res.ok && res.data ? res.data.settings : null;
}
