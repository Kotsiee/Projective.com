import { define } from "@web/utils/state.ts";
import { resolveSubmissionPage } from "@web/features/projects/core/submissions-ssr.ts";
import SubmissionExplorer from "@web/features/projects/islands/SubmissionExplorer.island.tsx";

/**
 * Project-scoped Submissions ledger (`/projects/[projectId]/submissions/…`) — every deliverable across
 * the project, with the project **Stages** prepended as the root system nodes of the navigation tree
 * (Part 5). A WILDCARD (`[...path]`) route so a deep tree node (stage → submitter → unit → directory) is
 * a real, deep-linkable URL; the bare `…/submissions` matches too (zero trailing segments). A static
 * `submissions` segment takes precedence over the `[channelId]` dynamic, so this never shadows a real
 * channel (mirroring `files.tsx`/`attachments.tsx`). Resolves the initial page server-side (the fat
 * {@link ProjectBackendService.submissions}, `channelId` omitted → project scope). This is a project-view
 * path (not a channel), so the shell mounts no channel header — only the Project Details lane + the
 * footer View Control Rig + Review trigger.
 */
export default define.page(function ProjectSubmissionsPage(ctx) {
	const { projectId } = ctx.params;
	const path = (ctx.params.path ?? "").split("/").filter(Boolean);
	const { page } = resolveSubmissionPage(projectId, null, path);
	return <SubmissionExplorer scope="project" projectId={projectId} initial={page} />;
});
