import type {
	AvailabilityBehavior,
	CalendarEvent,
	CreateRoutineInput,
	OrganiseEntryInput,
	Routine,
	UpdateRoutineInput,
} from "@projective/types/scheduling";
import { uuid } from "@projective/types/scheduling";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	type EntryDeps,
	openSchedule,
	organise,
	organiseChanges,
	sched,
	writeRefusal,
} from "./live-entries.ts";

/**
 * live-routines — a person's routines on `/calendar`, and how an entry is organised under one (Decision
 * #389). Every write runs AS THE CALLER, under RLS, as `live-entries.ts` does. A routine has no
 * negotiation to protect, so `Manage routines` is the whole gate, and a client's reach is narrowed
 * further by the column grants: nobody moves a routine to another schedule, and nobody deletes one.
 *
 * {@link organiseEntry} is the one write an entry read from a connected calendar takes (`hostRefusal`
 * refuses it everything else, Decision #387 (f)), because it reaches no provider.
 */

/** What every read of a routine selects. */
export const ROUTINE_COLUMNS =
	"id, schedule_id, name, slug, color_token, is_active, behavior, recurrence_rule, metadata, created_at, updated_at";

/** A row of `scheduling.routines`. */
export interface RoutineRow {
	id: string;
	schedule_id: string;
	name: string;
	slug: string;
	color_token: string | null;
	is_active: boolean;
	behavior: AvailabilityBehavior;
	recurrence_rule: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

type Caller = ReadActor & { accessToken: string };

const GONE = "That routine is no longer on your calendar.";
const NOTHING = "Choose what to change.";
const NOT_YOURS = "Only an entry on your own calendar can be organised.";

/** A row as the page carries it. */
export function routineOf(row: RoutineRow): Routine {
	return {
		id: row.id,
		scheduleId: row.schedule_id,
		name: row.name,
		slug: row.slug,
		colorToken: row.color_token,
		isActive: row.is_active,
		behavior: row.behavior,
		recurrenceRule: row.recurrence_rule,
		metadata: row.metadata,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** Create a routine on the caller's own schedule, which is opened on first use, as for an entry. */
export async function createRoutine(
	input: CreateRoutineInput,
	actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<{ routine: Routine }>> {
	const scheduleId = await openSchedule(deps.db, actor.userId);
	const { data, error } = await sched(deps.db).from("routines").insert({
		schedule_id: scheduleId,
		name: input.name,
		recurrence_rule: input.recurrenceRule ?? null,
		...(input.behavior ? { behavior: input.behavior } : {}),
		...(input.colorToken ? { color_token: input.colorToken } : {}),
	}).select(ROUTINE_COLUMNS).single();
	if (error) return writeRefusal(error);
	return ok({ routine: routineOf(data as unknown as RoutineRow) }, { status: 201 });
}

/**
 * Change a routine. RLS answers a row the caller may not touch with no row at all, which reads as a
 * `404` rather than confirming it exists. Archiving is `isActive: false`, and a routine's behaviour
 * reaches its entries through `trg_routine_behavior`.
 */
export async function updateRoutine(
	input: UpdateRoutineInput,
	_actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<{ routine: Routine }>> {
	const { id, name, behavior, colorToken, recurrenceRule, isActive } = input;
	const changes = {
		...(name === undefined ? {} : { name }),
		...(behavior === undefined ? {} : { behavior }),
		...(colorToken === undefined ? {} : { color_token: colorToken }),
		...(recurrenceRule === undefined ? {} : { recurrence_rule: recurrenceRule }),
		...(isActive === undefined ? {} : { is_active: isActive }),
	};
	if (Object.keys(changes).length === 0) return fail(422, { message: NOTHING });
	const { data, error } = await sched(deps.db).from("routines").update(changes)
		.eq("id", id).select(ROUTINE_COLUMNS);
	if (error) return writeRefusal(error);
	const [row] = (data ?? []) as unknown as RoutineRow[];
	return row ? ok({ routine: routineOf(row) }) : fail(404, { message: GONE });
}

/**
 * Organise one entry and its whole series. An id that is not a persisted entry's (a due date, a call)
 * names something derived from elsewhere, which has no row to organise.
 */
export async function organiseEntry(
	input: OrganiseEntryInput,
	_actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<{ events: CalendarEvent[] }>> {
	const changes = organiseChanges(input.routineId, input.availabilityBehavior);
	if (!changes) return fail(422, { message: NOTHING });
	if (!uuid.safeParse(input.eventId).success) return fail(403, { message: NOT_YOURS });
	const { data, error } = await organise(deps.db, input.eventId, changes);
	if (error) {
		return error.code === "42501" ? fail(403, { message: NOT_YOURS }) : writeRefusal(error);
	}
	return ok({ events: await deps.reread((data ?? []) as string[]) });
}
