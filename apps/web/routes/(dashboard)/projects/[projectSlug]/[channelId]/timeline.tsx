import { define } from "@web/utils/state.ts";
import { resolveTimelinePage } from "@web/features/projects/core/timeline-ssr.ts";
import ProjectTimeline from "@web/features/projects/islands/ProjectTimeline.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Timeline tab — one stage's Gantt (`/projects/[projectId]/[channelId]/timeline`): the stage's own
 * window on its lane, then one lane per ticket in the stage so the stage's work reads as a schedule.
 * Resolves the stage-scoped timeline server-side (the fat {@link ProjectBackendService.timeline}
 * scoped by `channelId`, the same scoping the Tasks board uses) and hands it to the
 * {@link ProjectTimeline} island. The channel header (active Timeline tab) + the footer rig are
 * mounted by the shell.
 */
export default define.page(async function ChannelTimelinePage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId, channelId } = ctx.params;
	const { page } = await resolveTimelinePage(projectId, actor, channelId);
	return (
		<ProjectTimeline scope="channel" projectId={projectId} channelId={channelId} initial={page} />
	);
});
