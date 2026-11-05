import type { CalendarEvent, Routine, UpdateRoutineInput } from "@projective/types/scheduling";
import { calendarRoutines } from "./calendar-state.ts";
import { entryEditable } from "./event-view.ts";
import { ScheduleService } from "./ScheduleService.ts";

/**
 * routine-actions — the routine writes the lane, the inspector and the dialog share. Each answers the
 * server's own words on a refusal, or `null`, so a region says it where the reader is looking.
 */

/**
 * Whether the reader may organise this entry: their own, or one read from their connected calendar,
 * which takes this and nothing else (Decision #387 (f)). Anything derived has no row to organise.
 */
export function entryOrganisable(event: CalendarEvent): boolean {
	return event.connected === true || entryEditable(event);
}

function put(routine: Routine): void {
	calendarRoutines.value = (calendarRoutines.peek() ?? []).map((r) =>
		r.id === routine.id ? routine : r
	);
}

/**
 * Change a routine at once, then keep the server's copy, or put it back. An archived routine leaves the
 * list, and its entries are loose again from the next render.
 */
export async function saveRoutine(
	routine: Routine,
	change: Omit<UpdateRoutineInput, "id">,
): Promise<string | null> {
	put({ ...routine, ...change });
	const res = await ScheduleService.updateRoutine({ id: routine.id, ...change });
	if (!res.ok || !res.data) {
		put(routine);
		return res.message ?? "That change could not be saved.";
	}
	const saved = res.data.routine;
	if (saved.isActive) put(saved);
	else calendarRoutines.value = (calendarRoutines.peek() ?? []).filter((r) => r.id !== saved.id);
	return null;
}
