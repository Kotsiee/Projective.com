import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";
import type { CalendarPage, SchedulePage } from "@projective/types/scheduling";

/**
 * calendar-ssr — the SSR resolvers. The calendar routes call these directly (no HTTP hop) to compute the
 * first-paint page from the fat {@link ScheduleBackendService}, then hand the payload to an island as its
 * `initial` prop. Islands never import these (they use the thin `ScheduleService`); this module is
 * server-only (it reaches the backend).
 */

export interface CalendarBootstrap {
	page: CalendarPage | null;
}
export interface ScheduleBootstrap {
	page: SchedulePage | null;
}

/** The project / channel calendar page (channelId omitted → whole project). */
export function resolveCalendarPage(projectId: string, channelId?: string | null): CalendarBootstrap {
	const res = ScheduleBackendService.projectCalendar({ projectId, channelId: channelId ?? null });
	return { page: res.ok && res.data ? res.data.page : null };
}

/** A `@handle`'s availability schedule page. */
export function resolveAvailabilityPage(handle: string): ScheduleBootstrap {
	const res = ScheduleBackendService.availability({ handle });
	return { page: res.ok && res.data ? res.data.page : null };
}

/** A session-based entity's schedule page. */
export function resolveSchedulePage(entityId: string): ScheduleBootstrap {
	const res = ScheduleBackendService.entitySchedule({ entityId });
	return { page: res.ok && res.data ? res.data.page : null };
}
