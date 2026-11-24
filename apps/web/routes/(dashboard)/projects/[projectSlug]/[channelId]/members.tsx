import { define } from "@web/utils/state.ts";
import { resolveMemberRoster } from "@web/features/projects/core/members-ssr.ts";
import { MembersView } from "@web/features/projects/components/workspace-views.tsx";
import { readActor } from "@web/utils/api-session.ts";
import { MEMBER_SECTION_PARAM } from "@web/features/projects/core/member-sections.ts";
import { isSlug } from "@projective/types/slugs";
import { resolveConversationRoster } from "@web/features/messaging/core/conversations-ssr.ts";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Members tab — the channel/stage-scoped roster (`/projects/[projectId]/[channelId]/members`): the
 * participants with access to THIS channel, their engagement role, and — on a stage channel — whether
 * they are an Assigned Contributor or an Observer. Resolves the first roster page server-side (the fat
 * {@link ProjectBackendService.members}, no HTTP hop) and hands it to the {@link MemberRoster} island;
 * the island refines client-side (search / filter / sort / layout) and re-simulates via the thin
 * `MembersService` when the Dev Context Switcher changes. The channel header (with the active Members
 * tab) is mounted by the shell — this route renders only the workspace body.
 *
 * A `cht-` segment is a thread seen through the project (Decision #339 ruling N1), already confirmed
 * by the `[channelId]` middleware as one of the project's Private Messages. Its members are the
 * thread's participants, so it renders the roster `/messages/cht-…/members` renders (the fat
 * {@link MessagingBackendService.members}, the `conversation` scope) (PROJECTS CH3; Decision #508 (c)).
 */
export default define.page(async function ChannelMembersPage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId, channelId } = ctx.params;
	if (isSlug(channelId, "thread")) {
		const page = await resolveConversationRoster(channelId, actor);
		if (!page) return <ConversationNotFound />;
		return <MembersView scope="conversation" id={channelId} channelId={channelId} initial={page} />;
	}
	const { page } = await resolveMemberRoster(projectId, actor, channelId);
	return (
		<MembersView
			scope="channel"
			id={projectId}
			channelId={channelId}
			initial={page}
			view={ctx.url.searchParams.get(MEMBER_SECTION_PARAM)}
		/>
	);
});
