import type { CalendarEvent, Routine } from "@projective/types/scheduling";

/**
 * event-deep-link — `/calendar?event=<event id>`, the address of one occurrence: what other surfaces
 * hand off to (the catalogue's client pipeline links a call or a sitting this way, Decision #218(a)),
 * what a reminder links to, and what the address reads while an entry is in the inspector, so a reload
 * or a pasted link lands on the same entry. `?routine=<rtn- slug>` is the same for a routine (Decision
 * #389), and the inspector holds one or the other, so writing either drops both. Pure: the island reads
 * and writes the address, these answer what it names and what it becomes.
 */

/** The query parameter that names an event. */
export const EVENT_PARAM = "event";

/** The query parameter that names a routine, by its opaque `rtn-` slug. */
export const ROUTINE_PARAM = "routine";

/** The query parameter that narrows the agenda, and the one narrowing an address can name. */
export const FILTER_PARAM = "filter";
export const INVITATIONS_FILTER = "invitations";

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
	q.delete(ROUTINE_PARAM);
	if (id) q.set(EVENT_PARAM, id);
	else q.delete(EVENT_PARAM);
	const rest = q.toString();
	return rest ? `${pathname}?${rest}` : pathname;
}

/** Does the address narrow the agenda to invitations? */
export function invitationsFiltered(search: string): boolean {
	return new URLSearchParams(search).get(FILTER_PARAM) === INVITATIONS_FILTER;
}

/** The address with that narrowing on or off, the rest of the query untouched. */
export function withInvitationsFilter(pathname: string, search: string, on: boolean): string {
	const q = new URLSearchParams(search);
	if (on) q.set(FILTER_PARAM, INVITATIONS_FILTER);
	else q.delete(FILTER_PARAM);
	const rest = q.toString();
	return rest ? `${pathname}?${rest}` : pathname;
}

/** The routine the address names, when it is among the reader's own; `null` otherwise. */
export function deepLinkedRoutine(search: string, routines: readonly Routine[]): Routine | null {
	const slug = new URLSearchParams(search).get(ROUTINE_PARAM);
	if (!slug) return null;
	return routines.find((r) => r.slug === slug) ?? null;
}

/** The address naming a routine, or with `null` naming nothing, the rest of the query untouched. */
export function withRoutineParam(pathname: string, search: string, slug: string | null): string {
	const q = new URLSearchParams(search);
	q.delete(EVENT_PARAM);
	if (slug) q.set(ROUTINE_PARAM, slug);
	else q.delete(ROUTINE_PARAM);
	const rest = q.toString();
	return rest ? `${pathname}?${rest}` : pathname;
}
