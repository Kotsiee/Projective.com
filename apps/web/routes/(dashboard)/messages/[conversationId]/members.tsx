import { define } from "@web/utils/state.ts";
import { resolveConversation } from "@web/features/messaging/core/conversations-ssr.ts";
import ConversationMembers from "@web/features/messaging/islands/ConversationMembers.island.tsx";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Members tab — the conversation participants (`/messages/[conversationId]/members`). Resolves the
 * conversation metadata server-side and hands the roster to the {@link ConversationMembers} island,
 * whose Add-members action (a group-conversion, task §2B) opens the shared contact picker.
 */
export default define.page(function ConversationMembersPage(ctx) {
	const { conversationId } = ctx.params;
	const detail = resolveConversation(conversationId);
	if (!detail) return <ConversationNotFound />;
	return <ConversationMembers detail={detail} />;
});
