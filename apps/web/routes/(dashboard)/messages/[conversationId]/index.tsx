import { define } from "@web/utils/state.ts";
import {
	resolveConversation,
	resolveConversationMessages,
} from "@web/features/messaging/core/conversations-ssr.ts";
import ConversationChat from "@web/features/messaging/islands/ConversationChat.island.tsx";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Chat tab — the default conversation view (`/messages/[conversationId]`, and the explicit index). It
 * SSR-resolves the LATEST message page from the fat service (no HTTP hop) and hands it to the
 * {@link ConversationChat} island (the reused project {@link ChatFeed} with a messaging pager). The
 * composer is the middle-nav frame's footer band, not part of this body.
 */
export default define.page(function ConversationChatPage(ctx) {
	const { conversationId } = ctx.params;
	if (!resolveConversation(conversationId)) return <ConversationNotFound />;
	const page = resolveConversationMessages(conversationId);
	return <ConversationChat conversationId={conversationId} initial={page} />;
});
