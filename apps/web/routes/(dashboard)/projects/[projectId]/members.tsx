import { define } from "@web/utils/state.ts";
import { resolveMemberRoster } from "@web/features/projects/core/members-ssr.ts";
import { MembersView } from "@web/features/projects/components/workspace-views.tsx";

/**
 * Project-scoped Members management (`/projects/[projectId]/members`) — every participant across the
 * whole engagement (the "Members" core view link in the Project Details sidebar), with their role,
 * the stages they contribute to, workload, contact, and join date, plus the pending-invitation queue.
 * Resolves the first (all-participants) roster page server-side (the fat
 * {@link ProjectBackendService.members}, no HTTP hop, `channelId` omitted → project scope) and hands it
 * to the {@link MemberRoster} island. This is a project-view path (not a channel), so the shell mounts
 * no channel header — only the Project Details lane.
 */
export default define.page(function ProjectMembersPage(ctx) {
	const { projectId } = ctx.params;
	const { page } = resolveMemberRoster(projectId);
	return <MembersView scope="project" id={projectId} initial={page} />;
});
