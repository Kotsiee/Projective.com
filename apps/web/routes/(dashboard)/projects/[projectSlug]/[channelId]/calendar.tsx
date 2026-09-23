import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveCalendarPage } from "@web/features/calendar/core/calendar-ssr.ts";
import { readActor } from "@web/utils/api-session.ts";
import { taskAbsentViewRedirect } from "@web/features/projects/core/task-view-guard.ts";
import ProjectCalendar from "@web/features/calendar/islands/ProjectCalendar.island.tsx";

/**
 * Calendar tab — the channel's schedule (`/projects/[projectId]/[channelId]/calendar`): the stage's
 * syncs, review milestones, deadlines, and (session engagements) recurring sessions. Resolves the
 * channel-scoped calendar page server-side (the fat {@link ScheduleBackendService.projectCalendar}, no
 * HTTP hop) and hands it to the {@link ProjectCalendar} island. The channel header (with the active
 * Calendar tab) + the Project Details lane are mounted by the shell; this route renders only the body.
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

export default define.page<typeof handler>(async function ChannelCalendarPage(ctx) {
	const { projectSlug: projectId, channelId } = ctx.params;
	const { page } = await resolveCalendarPage(projectId, channelId, readActor(ctx));
	return (
		<ProjectCalendar
			scope="channel"
			projectId={projectId}
			channelId={channelId}
			initial={initial}
		/>
	);
});
