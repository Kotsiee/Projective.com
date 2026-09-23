import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { CalendarPage, SchedulePage, SchedulingViewer } from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";

/**
 * calendar-ssr — the SSR resolvers. The calendar routes call these directly (no HTTP hop) to compute the
 * first-paint page from the fat {@link ScheduleBackendService}, then hand the payload to an island as its
 * `initial` prop. Islands never import these (they use the thin `ScheduleService`); this module is
 * server-only (it reaches the backend).
 *
 * The two PRIVATE reads — an engagement's calendar and the personal agenda — take the request's
 * {@link ReadActor} (build it with `readActor(ctx)`): they are read AS that person, under RLS, and the
 * service projects every event for them on the way out. The two PUBLIC reads take a
 * {@link SchedulingViewer} (build it with `viewerFromState`) because what they disclose is
 * world-readable by policy; it defaults to nobody, so a route that forgets ships the public
 * projection, not somebody's roster.
 *
 * A private read that fails (no session, a project the reader may not see, the database unreachable)
 * resolves to `page: null`, and the island renders its own empty or unavailable state from that.
 */

export interface CalendarBootstrap {
	page: CalendarPage | null;
}
export interface ScheduleBootstrap {
	page: SchedulePage | null;
}

/** The project / channel calendar page (channelId omitted → whole project), read as the actor. */
export async function resolveCalendarPage(
	projectId: string,
	channelId: string | null | undefined,
	actor: ReadActor,
): Promise<CalendarBootstrap> {
	const res = await ScheduleBackendService.projectCalendar(
		{ projectId, channelId: channelId ?? null },
		actor,
	);
	return { page: res.ok && res.data ? res.data.page : null };
}

/**
 * The acting account's own agenda for the `/calendar` hub, read as the actor.
 *
 * `null` means the agenda could not be read at all (no session, the database unreachable) — never
 * that the account has nothing on: an empty week is a page with no events in it.
 */
export async function resolvePersonalCalendar(actor: ReadActor): Promise<ScheduleBootstrap> {
	const res = await ScheduleBackendService.personalCalendar(actor);
	return { page: res.ok && res.data ? res.data.page : null };
}

/** A `@handle`'s availability schedule page, read live from their published schedule. */
export async function resolveAvailabilityPage(
	handle: string,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
): Promise<ScheduleBootstrap> {
	const res = await ScheduleBackendService.availability({ handle }, viewer);
	return { page: res.ok && res.data ? res.data.page : null };
}

/** A session listing's schedule page, read live from its provider's published schedule. */
export async function resolveSchedulePage(
	entityId: string,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
): Promise<ScheduleBootstrap> {
	const res = await ScheduleBackendService.entitySchedule({ entityId }, viewer);
	return { page: res.ok && res.data ? res.data.page : null };
}
