import type { CalendarEvent } from "@projective/types/scheduling";

/**
 * event-deep-link — `/calendar?event=<event id>`, the address other surfaces hand off to for one
 * occurrence (the catalogue's client pipeline links a call or a sitting this way, Decision #218(a)).
 * Pure: the island reads the address, these answer what it names and what the address becomes once
 * the event is closed.
 */

/** The query parameter that names an event. */
export const EVENT_PARAM = "event";

/** The event the address names, when it is on the agenda the page holds; `null` otherwise. */
export function deepLinkedEvent(
	search: string,
	events: readonly CalendarEvent[],
): CalendarEvent | null {
	const id = new URLSearchParams(search).get(EVENT_PARAM);
	if (!id) return null;
	return events.find((e) => e.id === id) ?? null;
}

/** The address with the event dropped, so closing it leaves no entry that reopens it on reload. */
export function withoutEventParam(pathname: string, search: string): string {
	const q = new URLSearchParams(search);
	q.delete(EVENT_PARAM);
	const rest = q.toString();
	return rest ? `${pathname}?${rest}` : pathname;
}
