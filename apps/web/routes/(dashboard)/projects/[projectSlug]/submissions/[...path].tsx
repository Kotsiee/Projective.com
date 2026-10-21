import { define } from "@web/utils/state.ts";
import { resolveSubmissionPageOnce } from "@web/features/projects/core/submissions-ssr.ts";
import { pathSegmentsAfter } from "@web/features/projects/core/explorer-header-slot.tsx";
import SubmissionExplorer from "@web/features/projects/islands/SubmissionExplorer.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Project-scoped Submissions ledger (`/projects/[projectId]/submissions/…`) — every deliverable across
 * the project, with the project **Stages** prepended as the root system nodes of the navigation tree
 * (Part 5). A WILDCARD (`[...path]`) route so a deep tree node (stage → submitter → unit → directory) is
 * a real, deep-linkable URL; the bare `…/submissions` matches too (zero trailing segments). A static
 * `submissions` segment takes precedence over the `[channelId]` dynamic, so this never shadows a real
 * channel (mirroring `files.tsx`/`attachments.tsx`). Resolves the initial page server-side (the fat
 * {@link ProjectBackendService.submissions}, `channelId` omitted → project scope), read once per request
 * because the header band titles the same node. This is a project-view path (not a channel), so no
 * channel header claims the band: it carries the node's title and the explorer's toolbar
 * (`explorerHeaderFor`, Decision #317); the shell also mounts the Project Details lane + the footer
 * View Control Rig + Review trigger.
 */
export default define.page(async function ProjectSubmissionsPage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId } = ctx.params;
	const path = pathSegmentsAfter(ctx.url, 3);
	const { page } = await resolveSubmissionPageOnce(ctx.url, projectId, actor, null, path);
	return <SubmissionExplorer scope="project" projectId={projectId} initial={page} />;
});
