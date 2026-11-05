import type { CalendarEvent, OrganiseEntryInput, Routine } from "@projective/types/scheduling";
import { AVAILABILITY_BEHAVIOR_SHORT } from "@projective/types/scheduling";

/**
 * routine-view — what the lane, the inspector and the event modal read off a routine (Decision #389).
 * Pure, and free of the calendar engine's stylesheets, so `deno test` can reach it.
 */

/** What organising an entry changes: its routine (`null` is out of it) and its behaviour. */
export type EntryOrganisation = Partial<
	Pick<CalendarEvent, "availabilityBehavior"> & Pick<OrganiseEntryInput, "routineId">
>;

/** The same change as a working copy spells it, where no routine is an absent field. */
export function organisedPatch(change: EntryOrganisation): Partial<CalendarEvent> {
	const { routineId, ...rest } = change;
	return routineId === undefined ? rest : { ...rest, routineId: routineId ?? undefined };
}

// #region Reading
/** A row of the lane: a routine and what it holds, or the entries in no routine at all. */
export interface RoutineGroups {
	groups: { routine: Routine; members: CalendarEvent[] }[];
	loose: CalendarEvent[];
}

/**
 * Split the list's rows by routine, in the order the routines were made. An entry whose routine is not
 * among the live ones (it was archived) is simply an entry again, which is what archiving promises.
 */
export function groupByRoutine(
	rows: readonly CalendarEvent[],
	routines: readonly Routine[],
): RoutineGroups {
	const live = new Set(routines.map((r) => r.id));
	return {
		groups: routines.map((routine) => ({
			routine,
			members: rows.filter((e) => e.routineId === routine.id),
		})),
		loose: rows.filter((e) => !e.routineId || !live.has(e.routineId)),
	};
}

/** The routine's line in the Meta register: "3 entries · Passive". */
export function routineMeta(routine: Routine, count: number): string {
	return `${count} ${count === 1 ? "entry" : "entries"} · ${
		AVAILABILITY_BEHAVIOR_SHORT[routine.behavior]
	}`;
}

/** Whether somebody else relies on this entry, so it can only hold its time (`fn_event_holds_time`). */
export function entryHoldsTime(event: CalendarEvent): boolean {
	return event.kind === "session" || event.kind === "booking" || !!event.projectId ||
		(event.roster?.length ?? 0) > 0;
}

/**
 * Where a passive routine's inspector points: Session Services on the marketplace, on the routine's
 * own words. A person who keeps "Spanish" open on their week is the audience for a Spanish tutor.
 */
export function sessionServicesHref(routine: Routine): string {
	const q = new URLSearchParams({ q: routine.name, category: "services", model: "session" });
	return `/explore?${q.toString()}`;
}
