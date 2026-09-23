import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveCalendarPage } from "@web/features/calendar/core/calendar-ssr.ts";
import { viewerFromState } from "@web/features/calendar/core/viewer.ts";
import { taskAbsentViewRedirect } from "@web/features/projects/core/task-view-guard.ts";
import ProjectCalendar from "@web/features/calendar/islands/ProjectCalendar.island.tsx";

/**
 * Calendar — the project-level schedule (`/projects/[projectId]/calendar`): every stage's syncs, review
 * milestones, and deadlines across the whole engagement (plus recurring sessions for session formats).
 * Resolves the project-scoped calendar page server-side (the fat {@link ScheduleBackendService.projectCalendar},
 * no HTTP hop, `channelId` omitted → whole project) and hands it to the {@link ProjectCalendar} island.
 * This is a project-view path (not a channel), so the shell mounts no channel header — only the Project
 * Details lane; this route renders only the calendar body.
 *
 * A Task has no calendar — its one date is its due date, which its lane already states — so a request
 * for it is sent to the engagement itself ({@link taskAbsentViewRedirect}).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.projectSlug;
		const redirect = await taskAbsentViewRedirect(ctx, slug, `/projects/${slug}`);
		return redirect ?? page();
	},
});

export default define.page<typeof handler>(function ProjectCalendarPage(ctx) {
	const { projectSlug: projectId } = ctx.params;
	const { page: initial } = resolveCalendarPage(projectId, null, viewerFromState(ctx.state));
	return <ProjectCalendar scope="project" projectId={projectId} initial={initial} />;
});
