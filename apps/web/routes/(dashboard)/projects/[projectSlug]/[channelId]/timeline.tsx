import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveTimelinePage } from "@web/features/projects/core/timeline-ssr.ts";
import { taskAbsentViewRedirect } from "@web/features/projects/core/task-view-guard.ts";
import ProjectTimeline from "@web/features/projects/islands/ProjectTimeline.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Timeline tab — one stage's Gantt (`/projects/[projectId]/[channelId]/timeline`): the stage's own
 * window on its lane, then one lane per ticket in the stage so the stage's work reads as a schedule.
 * Resolves the stage-scoped timeline server-side (the fat {@link ProjectBackendService.timeline}
 * scoped by `channelId`, the same scoping the Tasks board uses) and hands it to the
 * {@link ProjectTimeline} island. The channel header (active Timeline tab) + the footer rig are
 * mounted by the shell.
 *
 * On a Task the tab does not exist, so a request for it is sent to the room's Chat
 * ({@link taskAbsentViewRedirect}).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { projectSlug: slug, channelId } = ctx.params;
		const redirect = await taskAbsentViewRedirect(ctx, slug, `/projects/${slug}/${channelId}`);
		return redirect ?? page();
	},
});

export default define.page<typeof handler>(async function ChannelTimelinePage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId, channelId } = ctx.params;
	const { page: initial } = await resolveTimelinePage(projectId, actor, channelId);
	return (
		<ProjectTimeline
			scope="channel"
			projectId={projectId}
			channelId={channelId}
			initial={initial}
		/>
	);
});
