import { getScheduling } from "./api.ts";
import type { CalendarPage, SchedulePage } from "@projective/types/scheduling";
import type { CalendarResult } from "../types/results.ts";

/**
 * ScheduleService — the THIN client service the calendar islands use to (re)fetch a page. It builds the
 * query string and delegates to {@link getScheduling}; it never touches the backend directly (that is
 * the SSR resolver's job). One method per surface, each mapping to a `/api/scheduling/*` route.
 */
export const ScheduleService = {
	/** The project (or channel) calendar page. */
	calendar(projectId: string, channelId?: string | null): Promise<CalendarResult<{ page: CalendarPage }>> {
		const qs = new URLSearchParams({ projectId });
		if (channelId) qs.set("channelId", channelId);
		return getScheduling<{ page: CalendarPage }>(`/api/scheduling/calendar?${qs.toString()}`);
	},

	/** A `@handle`'s availability schedule page. */
	availability(handle: string): Promise<CalendarResult<{ page: SchedulePage }>> {
		const qs = new URLSearchParams({ handle });
		return getScheduling<{ page: SchedulePage }>(`/api/scheduling/availability?${qs.toString()}`);
	},

	/** A session-based entity's schedule page. */
	schedule(entityId: string): Promise<CalendarResult<{ page: SchedulePage }>> {
		const qs = new URLSearchParams({ entityId });
		return getScheduling<{ page: SchedulePage }>(`/api/scheduling/schedule?${qs.toString()}`);
	},
};
