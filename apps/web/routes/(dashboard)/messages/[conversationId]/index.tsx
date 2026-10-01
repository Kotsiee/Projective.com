import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	resolveConversation,
	resolveConversationContext,
	resolveConversationMessages,
} from "@web/features/messaging/core/conversations-ssr.ts";
import ConversationChat from "@web/features/messaging/islands/ConversationChat.island.tsx";
import ConversationContextPanel from "@web/features/messaging/islands/ConversationContextPanel.island.tsx";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Chat tab — the default conversation view (`/messages/[conversationId]`, and the explicit index). It
 * SSR-resolves the LATEST message page from the fat service (no HTTP hop) and hands it to the
 * {@link ConversationChat} island (the reused project {@link ChatFeed} with a messaging pager). The
 * composer is the middle-nav frame's footer band, not part of this body.
 *
 * `async` because both reads reach Postgres once `MESSAGING_BACKEND_LIVE` is on. The existence check
 * and the message page are awaited TOGETHER rather than in series: the page read does not depend on
 * the existence check's result — a conversation the viewer cannot see returns no messages either — so
 * sequencing them would add a whole round trip to every conversation open for no ordering benefit.
 *
 * A one-to-one conversation also gets its context panel (who the counterpart is, the request between
 * the two, and what the viewer can do about it) at the thread's right edge; a group has none.
 */
export default define.page(async function ConversationChatPage(ctx) {
	const { conversationId } = ctx.params;
	const actor = readActor(ctx);
	const [detail, page, context] = await Promise.all([
		resolveConversation(conversationId, actor),
		resolveConversationMessages(conversationId, actor),
		resolveConversationContext(conversationId, actor),
	]);
	if (!detail) return <ConversationNotFound />;
	if (detail.kind === "group") {
		return <ConversationChat conversationId={conversationId} initial={page} />;
	}
	return (
		<div class="msg-thread">
			<div class="msg-thread__chat">
				<ConversationChat conversationId={conversationId} initial={page} />
			</div>
			<ConversationContextPanel
				conversationId={conversationId}
				initial={context}
				folder={detail.folder}
			/>
		</div>
	);
});
