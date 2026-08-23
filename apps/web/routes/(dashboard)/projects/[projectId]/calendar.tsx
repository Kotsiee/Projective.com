import { define } from "@web/utils/state.ts";
import { resolveCalendarPage } from "@web/features/calendar/core/calendar-ssr.ts";
import { viewerFromState } from "@web/features/calendar/core/viewer.ts";
import ProjectCalendar from "@web/features/calendar/islands/ProjectCalendar.island.tsx";

/**
 * Calendar — the project-level schedule (`/projects/[projectId]/calendar`): every stage's syncs, review
 * milestones, and deadlines across the whole engagement (plus recurring sessions for session formats).
 * Resolves the project-scoped calendar page server-side (the fat {@link ScheduleBackendService.projectCalendar},
 * no HTTP hop, `channelId` omitted → whole project) and hands it to the {@link ProjectCalendar} island.
 * This is a project-view path (not a channel), so the shell mounts no channel header — only the Project
 * Details lane; this route renders only the calendar body.
 */
export default define.page(function ProjectCalendarPage(ctx) {
	const { projectId } = ctx.params;
	const { page } = resolveCalendarPage(projectId, null, viewerFromState(ctx.state));
	return <ProjectCalendar scope="project" projectId={projectId} initial={page} />;
});
