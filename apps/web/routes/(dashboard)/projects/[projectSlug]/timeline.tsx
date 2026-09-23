import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveTimelinePage } from "@web/features/projects/core/timeline-ssr.ts";
import { taskAbsentViewRedirect } from "@web/features/projects/core/task-view-guard.ts";
import ProjectTimeline from "@web/features/projects/islands/ProjectTimeline.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Timeline — the project-level Gantt (`/projects/[projectId]/timeline`): one lane per stage carrying
 * the stage's scheduled window and every dated ticket in it, dependency links between stages, and
 * a trailing lane for tickets not yet in a stage. Resolves the timeline server-side (the fat
 * {@link ProjectBackendService.timeline}, no HTTP hop — a projection over the SAME board read the
 * Kanban uses, so a bar and a card can never disagree about a date) and hands it to the
 * {@link ProjectTimeline} island. The lane (Project Details sidebar) and the footer rig are mounted
 * by the shell; this route renders only the timeline body.
 *
 * A Task has no timeline — one bar on one lane — so a request for it is sent to the engagement itself
 * ({@link taskAbsentViewRedirect}).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.projectSlug;
		const redirect = await taskAbsentViewRedirect(ctx, slug, `/projects/${slug}`);
		return redirect ?? page();
	},
});

export default define.page<typeof handler>(async function ProjectTimelinePage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId } = ctx.params;
	const { page: initial } = await resolveTimelinePage(projectId, actor);
	return <ProjectTimeline scope="project" projectId={projectId} initial={initial} />;
});
