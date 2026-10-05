import { define } from "@web/utils/state.ts";
import { resolveConversationRoster } from "@web/features/messaging/core/conversations-ssr.ts";
import { MembersView } from "@web/features/projects/components/workspace-views.tsx";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Members tab — the conversation participants (`/messages/[conversationId]/members`). Resolves the
 * roster server-side (the fat {@link MessagingBackendService.members}, no HTTP hop) and hands it to the
 * shared {@link MembersView} — the SAME component tree the channel Members tab mounts, so the inbox
 * gets the identical cards ⇄ table roster, preview and Message actions rather than a lookalike list.
 * A conversation has no stages, requests or invitations, so it offers the Members section alone.
 */
export default define.page(async function ConversationMembersPage(ctx) {
	const actor = readActor(ctx);
	const { conversationId } = ctx.params;
	const page = await resolveConversationRoster(conversationId, actor);
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
