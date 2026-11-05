import { getScheduling, postScheduling } from "./api.ts";
import type {
	CalendarEvent,
	CalendarPage,
	CallActionInput,
	EntryFields,
	EntryReminder,
	EntryRoom,
	RescheduleInput,
	RsvpInput,
	SchedulePage,
} from "@projective/types/scheduling";
import type { CalendarResult } from "../types/results.ts";

/**
 * ScheduleService — the THIN client service the calendar islands use to (re)fetch a page or record a
 * response. It builds the query string / body and delegates to {@link getScheduling} /
 * {@link postScheduling}; it never touches the backend directly (that is the SSR resolver's job), and
 * it decides nothing — a refused write comes back with `errors.reason`, a `RescheduleRefusalReason`,
 * which the surface renders rather than re-deriving.
 *
 * Nothing here names WHO is asking: every private read and every write is answered as the session's
 * own user, so there is no parameter a caller could set to read or act as somebody else.
 */
export const ScheduleService = {
	/** The project (or channel) calendar page. */
	calendar(
		projectId: string,
		channelId?: string | null,
	): Promise<CalendarResult<{ page: CalendarPage }>> {
		const qs = new URLSearchParams({ projectId });
		if (channelId) qs.set("channelId", channelId);
		return getScheduling<{ page: CalendarPage }>(`/api/scheduling/calendar?${qs.toString()}`);
	},

	/** The acting account's own agenda (`/calendar`). Scope comes from the session, never a param. */
	personal(): Promise<CalendarResult<{ page: SchedulePage }>> {
		return getScheduling<{ page: SchedulePage }>("/api/scheduling/personal");
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

	/** Record the viewer's own RSVP; resolves with the refreshed event. */
	respond(input: RsvpInput): Promise<CalendarResult<{ event: CalendarEvent }>> {
		return postScheduling<{ event: CalendarEvent }>("/api/scheduling/rsvp", input);
	},

	/** Make one move on a discovery call; resolves with it, or `null` once it has left the calendar. */
	callAction(input: CallActionInput): Promise<CalendarResult<{ event: CalendarEvent | null }>> {
		return postScheduling<{ event: CalendarEvent | null }>("/api/scheduling/calls", input);
	},

	/** Apply one move to an event's reschedule negotiation; resolves with the refreshed event. */
	reschedule(input: RescheduleInput): Promise<CalendarResult<{ event: CalendarEvent }>> {
		return postScheduling<{ event: CalendarEvent }>("/api/scheduling/reschedule", input);
	},

	/** Create entries on the caller's own calendar; resolves with them as the agenda draws them. */
	create(
		entries: EntryFields[],
		room?: EntryRoom | null,
		reminders?: EntryReminder[] | null,
	): Promise<CalendarResult<{ events: CalendarEvent[] }>> {
		return postScheduling<{ events: CalendarEvent[] }>(
			"/api/scheduling/events",
			{ entries, room, reminders },
		);
	},

	/** Edit one of the caller's own entries; resolves with it re-read. */
	update(
		eventId: string,
		fields: EntryFields,
		room?: EntryRoom | null,
	): Promise<CalendarResult<{ event: CalendarEvent }>> {
		return postScheduling<{ event: CalendarEvent }>(
			"/api/scheduling/events",
			{ ...fields, eventId, room },
			"PATCH",
		);
	},

	/** Set the caller's own alerts for an entry they hold; `null` follows their default. */
	setReminders(
		eventId: string,
		reminders: EntryReminder[] | null,
	): Promise<CalendarResult<{ event: CalendarEvent }>> {
		return postScheduling<{ event: CalendarEvent }>(
			"/api/scheduling/reminders",
			{ eventId, reminders },
			"PUT",
		);
	},

	/** Take one of the caller's own entries off the calendar. */
	remove(eventId: string): Promise<CalendarResult<{ eventId: string }>> {
		const qs = new URLSearchParams({ eventId });
		return postScheduling<{ eventId: string }>(
			`/api/scheduling/events?${qs.toString()}`,
			undefined,
			"DELETE",
		);
	},
};
