import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { taskAbsentViewRedirect } from "@web/features/projects/core/task-view-guard.ts";
import { readCalendarAddress } from "../core/calendar-address.ts";
import { resolveCalendarPage } from "../core/calendar-ssr.ts";
import ProjectCalendar from "../islands/ProjectCalendar.island.tsx";

/**
 * The engagement calendar, mounted at two addresses that differ only by the `channelId` param:
 *
 * - `/projects/[projectSlug]/calendar` — the project-level schedule: every stage's syncs, review
 *   milestones and deadlines across the whole engagement (plus recurring sessions for session
 *   formats). A project-view path, so the shell mounts only the Project Details lane.
 * - `/projects/[projectSlug]/[channelId]/calendar` — the channel's Calendar tab: that stage's
 *   schedule. The shell mounts the channel header (with the active tab) and the lane.
 *
 * Resolves the scoped page server-side (the fat {@link ScheduleBackendService.projectCalendar}, no
 * HTTP hop, read as the signed-in reader under RLS; no `channelId` → whole project) and hands it to
 * the {@link ProjectCalendar} island; this controller renders only the body.
 *
 * A Task has no calendar — its one date is its due date, which its lane already states — so a request
 * for it is sent to the engagement (project path) or the room's Chat (channel path)
 * ({@link taskAbsentViewRedirect}).
 *
 * The view is addressed as `?view=&date=&zoom=` (Decision #413): read here, so the first byte paints
 * the asked-for period, and a value this calendar does not answer (`kind`, `availability`) is a 303 to
 * the canonical address with it dropped.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { projectSlug: slug, channelId } = ctx.params;
		const fallback = channelId ? `/projects/${slug}/${channelId}` : `/projects/${slug}`;
		const redirect = await taskAbsentViewRedirect(ctx, slug, fallback);
		if (redirect) return redirect;
		const { address, redirect: canonical } = readCalendarAddress(ctx.url, "project");
		if (canonical) return new Response(null, { status: 303, headers: { location: canonical } });
		return page({ address });
	},
});

export default define.page<typeof handler>(async function ProjectCalendarPage(ctx) {
	const { projectSlug: projectId, channelId } = ctx.params;
	const { address } = ctx.data;
	const { page } = await resolveCalendarPage(
		projectId,
		channelId ?? null,
		readActor(ctx),
		address.date,
	);
	return channelId
		? (
			<ProjectCalendar
				scope="channel"
				projectId={projectId}
				channelId={channelId}
				initial={page}
				address={address}
			/>
		)
		: <ProjectCalendar scope="project" projectId={projectId} initial={page} address={address} />;
});
