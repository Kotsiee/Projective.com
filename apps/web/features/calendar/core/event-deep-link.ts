import type { CalendarEvent } from "@projective/types/scheduling";

/**
 * event-deep-link — `/calendar?event=<event id>`, the address of one occurrence: what other surfaces
 * hand off to (the catalogue's client pipeline links a call or a sitting this way, Decision #218(a)),
 * what a reminder links to, and what the address reads while an entry is in the inspector, so a reload
 * or a pasted link lands on the same entry. Pure: the island reads and writes the address, these answer
 * what it names and what it becomes.
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

/** The address naming `id`, or with the event dropped for `null`, the rest of the query untouched. */
export function withEventParam(pathname: string, search: string, id: string | null): string {
	const q = new URLSearchParams(search);
	if (id) q.set(EVENT_PARAM, id);
	else q.delete(EVENT_PARAM);
	const rest = q.toString();
	return rest ? `${pathname}?${rest}` : pathname;
}
