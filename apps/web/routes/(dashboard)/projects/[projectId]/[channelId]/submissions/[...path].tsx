import { define } from "@web/utils/state.ts";
import { resolveSubmissionPage } from "@web/features/projects/core/submissions-ssr.ts";
import SubmissionExplorer from "@web/features/projects/islands/SubmissionExplorer.island.tsx";

/**
 * Submissions tab — the channel-scoped Submissions explorer
 * (`/projects/[projectId]/[channelId]/submissions/…`): the deliverables submitted in this channel, with
 * the navigation tree + interactive breadcrumbs. A WILDCARD (`[...path]`) route so a deep tree node
 * (submitter → unit → directory) is a real, deep-linkable URL the breadcrumbs + tree address; the bare
 * `…/submissions` matches too (zero trailing segments). Resolves the file page for the requested path
 * server-side (the fat {@link ProjectBackendService.submissions}, no HTTP hop) and hands it to the
 * {@link SubmissionExplorer} island; the island refines / navigates via the thin `SubmissionsService`.
 * The channel header (with the active Submissions tab) and the footer View Control Rig + Review trigger
 * are mounted by the shell — this route renders only the workspace body.
 */
export default define.page(function ChannelSubmissionsPage(ctx) {
	const { projectId, channelId } = ctx.params;
	const path = (ctx.params.path ?? "").split("/").filter(Boolean);
	const { page } = resolveSubmissionPage(projectId, channelId, path);
	return (
		<SubmissionExplorer scope="channel" projectId={projectId} channelId={channelId} initial={page} />
	);
});
