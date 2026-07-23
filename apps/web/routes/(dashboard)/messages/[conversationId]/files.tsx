import { define } from "@web/utils/state.ts";
import { resolveConversationMessages } from "@web/features/messaging/core/conversations-ssr.ts";
import {
	type ConversationFileEntry,
	ConversationFilesView,
} from "@web/features/messaging/components/ConversationFilesView.tsx";

/**
 * Files tab — the conversation's shared attachments (`/messages/[conversationId]/files`). Derives the
 * file list server-side from the latest message page (the live path pages `messages.attachments` behind
 * `MESSAGING_BACKEND_LIVE`) and renders the lean {@link ConversationFilesView} grid. The header (active
 * Files tab) is mounted by the shell; this route renders only the workspace body.
 */
export default define.page(function ConversationFilesPage(ctx) {
	const { conversationId } = ctx.params;
	const page = resolveConversationMessages(conversationId);
	const files: ConversationFileEntry[] = (page?.messages ?? []).flatMap((m) =>
		m.attachments.map((a) => ({
			id: `${m.id}-${a.id}`,
			kind: a.kind,
			url: a.url,
			name: a.name,
			ext: a.ext,
			from: m.isOwn ? "You" : m.sender?.name ?? "Unknown",
			dayLabel: m.dayLabel,
		}))
	);
	return <ConversationFilesView files={files} />;
});
