import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
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
 *
 * `async` because both reads reach Postgres once `MESSAGING_BACKEND_LIVE` is on. The existence check
 * and the message page are awaited TOGETHER rather than in series: the page read does not depend on
 * the existence check's result — a conversation the viewer cannot see returns no messages either — so
 * sequencing them would add a whole round trip to every conversation open for no ordering benefit.
 *
 * Rendering writes nothing (PRD-C11). A read is the person having seen the latest page (CAS M10), and
 * a GET cannot know that: a prefetch, a link unfurler, a retry or a cross-site top-level navigation
 * (which carries the `SameSite=Lax` session cookie) fetches this page too. The island marks the thread
 * read instead, with `POST /api/messaging/conversations/[id]/read`, once it has painted in a visible
 * tab.
 *
 * A one-to-one conversation's context panel is NOT part of this body: the layout registers it as the
 * middle-nav frame's right panel (`conversationPanelFor`), so it spans the full frame height beside the
 * header, thread and composer and scrolls independently of the thread.
 */
export default define.page(async function ConversationChatPage(ctx) {
	const { conversationId } = ctx.params;
	const actor = readActor(ctx);
	const [detail, page] = await Promise.all([
		resolveConversation(conversationId, actor),
		resolveConversationMessages(conversationId, actor),
	]);
	if (!detail) return <ConversationNotFound />;
	return <ConversationChat conversationId={conversationId} initial={page} />;
});
