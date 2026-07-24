import { define } from "@web/utils/state.ts";
import { resolveMemberRoster } from "@web/features/projects/core/members-ssr.ts";
import { MembersView } from "@web/features/projects/components/workspace-views.tsx";

/**
 * Members tab — the channel/stage-scoped roster (`/projects/[projectId]/[channelId]/members`): the
 * participants with access to THIS channel, their engagement role, and — on a stage channel — whether
 * they are an Assigned Contributor or an Observer. Resolves the first roster page server-side (the fat
 * {@link ProjectBackendService.members}, no HTTP hop) and hands it to the {@link MemberRoster} island;
 * the island refines client-side (search / filter / sort / layout) and re-simulates via the thin
 * `MembersService` when the Dev Context Switcher changes. The channel header (with the active Members
 * tab) is mounted by the shell — this route renders only the workspace body.
 */
export default define.page(function ChannelMembersPage(ctx) {
	const { projectId, channelId } = ctx.params;
	const { page } = resolveMemberRoster(projectId, channelId);
	return <MembersView scope="channel" id={projectId} channelId={channelId} initial={page} />;
});
