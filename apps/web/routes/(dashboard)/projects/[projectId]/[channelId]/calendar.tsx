import { define } from "@web/utils/state.ts";
import { resolveCalendarPage } from "@web/features/calendar/core/calendar-ssr.ts";
import ProjectCalendar from "@web/features/calendar/islands/ProjectCalendar.island.tsx";

/**
 * Calendar tab — the channel's schedule (`/projects/[projectId]/[channelId]/calendar`): the stage's
 * syncs, review milestones, deadlines, and (session engagements) recurring sessions. Resolves the
 * channel-scoped calendar page server-side (the fat {@link ScheduleBackendService.projectCalendar}, no
 * HTTP hop) and hands it to the {@link ProjectCalendar} island. The channel header (with the active
 * Calendar tab) + the Project Details lane are mounted by the shell; this route renders only the body.
 */
export default define.page(function ChannelCalendarPage(ctx) {
	const { projectId, channelId } = ctx.params;
	const { page } = resolveCalendarPage(projectId, channelId);
	return <ProjectCalendar scope="channel" projectId={projectId} channelId={channelId} initial={page} />;
});
