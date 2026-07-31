import { define } from "@web/utils/state.ts";
import { resolveConversationFiles } from "@web/features/messaging/core/conversations-ssr.ts";
import { FilesView } from "@web/features/projects/components/workspace-views.tsx";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Files tab — the conversation's shared attachments (`/messages/[conversationId]/files`). Resolves the
 * first file page server-side (the fat {@link MessagingBackendService.files}, no HTTP hop) and hands it
 * to the shared {@link FilesView} — the SAME component tree the channel Files tab mounts, so the inbox
 * gets the identical zoom-driven grid⇄list explorer, window virtualization, and universal preview modal
 * rather than a lookalike grid. The island refines via the thin `FilesService`, which routes a
 * `conversation` scope to `/api/messaging/files`.
 *
 * The header (with the active Files tab) is mounted by the shell; this route renders only the body.
 */
export default define.page(function ConversationFilesPage(ctx) {
	const { conversationId } = ctx.params;
	// Guarded like the Chat and Members tabs: an unresolvable conversation must render the not-found
	// body, not a File Explorer over a null projection.
	const initial = resolveConversationFiles(conversationId);
	if (!initial) return <ConversationNotFound />;
	return (
		<FilesView
			scope="conversation"
			id={conversationId}
			channelId={conversationId}
			initial={initial}
		/>
	);
});
