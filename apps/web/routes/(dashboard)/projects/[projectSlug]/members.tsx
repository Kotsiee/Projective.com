import { define } from "@web/utils/state.ts";
import { resolveMemberRoster } from "@web/features/projects/core/members-ssr.ts";
import { MembersView } from "@web/features/projects/components/workspace-views.tsx";
import { readActor } from "@web/utils/api-session.ts";
import { MEMBER_SECTION_PARAM } from "@web/features/projects/core/member-sections.ts";

/**
 * Project-scoped Members management (`/projects/[projectId]/members`) — every participant across the
 * whole engagement (the "Members" core view link in the Project Details sidebar), with the open
 * requests and the invitations in their own sections (`?view=requests` · `?view=invitations`).
 * Resolves the first (all-participants) roster page server-side (the fat
 * {@link ProjectBackendService.members}, no HTTP hop, `channelId` omitted → project scope) and hands it
 * to the {@link MemberRoster} island. This is a project-view path (not a channel), so the shell mounts
 * no channel header — only the Project Details lane.
 */
export default define.page(async function ProjectMembersPage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId } = ctx.params;
	const { page } = await resolveMemberRoster(projectId, actor);
	return (
		<MembersView
			scope="project"
			id={projectId}
			initial={page}
			view={ctx.url.searchParams.get(MEMBER_SECTION_PARAM)}
		/>
	);
});
