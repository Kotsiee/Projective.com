import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";
import type {
	CalendarPage,
	SchedulePage,
	SchedulingSim,
	SchedulingViewer,
} from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";

/**
 * calendar-ssr — the SSR resolvers. The calendar routes call these directly (no HTTP hop) to compute the
 * first-paint page from the fat {@link ScheduleBackendService}, then hand the payload to an island as its
 * `initial` prop. Islands never import these (they use the thin `ScheduleService`); this module is
 * server-only (it reaches the backend).
 *
 * Each resolver takes the request's {@link SchedulingViewer} (build it with `viewerFromState`), because
 * the SSR payload is serialised into an island prop and shipped to the browser — so it is a response
 * body like any other and must be projected for its reader. It defaults to nobody: a route that
 * forgets ships the public projection, not somebody's roster.
 */

export interface CalendarBootstrap {
	page: CalendarPage | null;
}
export interface ScheduleBootstrap {
	page: SchedulePage | null;
}

/** The project / channel calendar page (channelId omitted → whole project). */
export function resolveCalendarPage(
	projectId: string,
	channelId?: string | null,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
): CalendarBootstrap {
	const res = ScheduleBackendService.projectCalendar(
		{ projectId, channelId: channelId ?? null },
		viewer,
	);
	return { page: res.ok && res.data ? res.data.page : null };
}

/**
 * The acting account's own agenda for the `/calendar` hub.
 *
 * There is no `null` branch: an account always has a calendar, so the resolver returns a page
 * rather than a bootstrap that a route then has to decide what to do with.
 */
export function resolvePersonalCalendar(
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	sim?: SchedulingSim,
): ScheduleBootstrap {
	const res = ScheduleBackendService.personalCalendar(viewer, sim);
	return { page: res.ok && res.data ? res.data.page : null };
}

/** A `@handle`'s availability schedule page. */
export function resolveAvailabilityPage(
	handle: string,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
): ScheduleBootstrap {
	const res = ScheduleBackendService.availability({ handle }, viewer);
	return { page: res.ok && res.data ? res.data.page : null };
}

/** A session-based entity's schedule page. */
export function resolveSchedulePage(
	entityId: string,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
): ScheduleBootstrap {
	const res = ScheduleBackendService.entitySchedule({ entityId }, viewer);
	return { page: res.ok && res.data ? res.data.page : null };
}
