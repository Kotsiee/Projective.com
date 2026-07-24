import { define } from "@web/utils/state.ts";
import { resolveConversationRoster } from "@web/features/messaging/core/conversations-ssr.ts";
import { MembersView } from "@web/features/projects/components/workspace-views.tsx";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Members tab — the conversation participants (`/messages/[conversationId]/members`). Resolves the
 * roster server-side (the fat {@link MessagingBackendService.members}, no HTTP hop) and hands it to the
 * shared {@link MembersView} — the SAME component tree the channel Members tab mounts, so the inbox
 * gets the identical table, avatar stacks, role tags, and management actions rather than a lookalike
 * list. A conversation has no stages and no invitation queue, so those columns simply stay empty.
 */
export default define.page(function ConversationMembersPage(ctx) {
	const { conversationId } = ctx.params;
	const page = resolveConversationRoster(conversationId);
	if (!page) return <ConversationNotFound />;
	return (
		<MembersView
			scope="conversation"
			id={conversationId}
			channelId={conversationId}
			initial={page}
		/>
	);
});
