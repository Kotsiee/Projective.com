import { getScheduling, postScheduling } from "./api.ts";
import type {
	CalendarEvent,
	CalendarPage,
	RescheduleInput,
	RsvpInput,
	SchedulePage,
	SchedulingSim,
} from "@projective/types/scheduling";
import { schedulingSimToQuery } from "@projective/types/scheduling";
import type { CalendarResult } from "../types/results.ts";

/**
 * ScheduleService — the THIN client service the calendar islands use to (re)fetch a page or record a
 * response. It builds the query string / body and delegates to {@link getScheduling} /
 * {@link postScheduling}; it never touches the backend directly (that is the SSR resolver's job), and
 * it decides nothing — a refused write comes back with `errors.reason`, a `RescheduleRefusalReason`,
 * which the surface renders rather than re-deriving.
 *
 * Every method takes the optional developer simulation overlay. On a READ it travels as `sim*` query
 * params; on a WRITE it rides the payload's own `sim` field, because the server re-resolves the event
 * through the very same reader that drew the page — hand it a different overlay and it addresses a
 * different event. In production the overlay is always `undefined` (the seam tree-shakes out), so the
 * request is byte-identical to one from before this existed.
 */
export const ScheduleService = {
	/** The project (or channel) calendar page. */
	calendar(
		projectId: string,
		channelId?: string | null,
		sim?: SchedulingSim,
	): Promise<CalendarResult<{ page: CalendarPage }>> {
		const qs = new URLSearchParams({ projectId });
		if (channelId) qs.set("channelId", channelId);
		return getScheduling<{ page: CalendarPage }>(
			`/api/scheduling/calendar?${qs.toString()}${schedulingSimToQuery(sim)}`,
		);
	},

	/** The acting account's own agenda (`/calendar`). Scope comes from the session, never a param. */
	personal(sim?: SchedulingSim): Promise<CalendarResult<{ page: SchedulePage }>> {
		// The SSOT emits a LEADING `&`, so a read with no other param needs a `?` in front of it.
		const q = schedulingSimToQuery(sim);
		return getScheduling<{ page: SchedulePage }>(
			`/api/scheduling/personal${q ? `?${q.slice(1)}` : ""}`,
		);
	},

	/** A `@handle`'s availability schedule page. */
	availability(
		handle: string,
		sim?: SchedulingSim,
	): Promise<CalendarResult<{ page: SchedulePage }>> {
		const qs = new URLSearchParams({ handle });
		return getScheduling<{ page: SchedulePage }>(
			`/api/scheduling/availability?${qs.toString()}${schedulingSimToQuery(sim)}`,
		);
	},

	/** A session-based entity's schedule page. */
	schedule(
		entityId: string,
		sim?: SchedulingSim,
	): Promise<CalendarResult<{ page: SchedulePage }>> {
		const qs = new URLSearchParams({ entityId });
		return getScheduling<{ page: SchedulePage }>(
			`/api/scheduling/schedule?${qs.toString()}${schedulingSimToQuery(sim)}`,
		);
	},

	/** Record the viewer's own RSVP; resolves with the refreshed event. */
	respond(input: RsvpInput): Promise<CalendarResult<{ event: CalendarEvent }>> {
		return postScheduling<{ event: CalendarEvent }>("/api/scheduling/rsvp", input);
	},

	/** Apply one move to an event's reschedule negotiation; resolves with the refreshed event. */
	reschedule(input: RescheduleInput): Promise<CalendarResult<{ event: CalendarEvent }>> {
		return postScheduling<{ event: CalendarEvent }>("/api/scheduling/reschedule", input);
	},
};
