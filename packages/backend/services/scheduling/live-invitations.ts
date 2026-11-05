import type {
	CalendarEvent,
	ClashQuery,
	EventClash,
	EventClashKind,
	EventClashVerdict,
	InviteInput,
	WithdrawInviteInput,
} from "@projective/types/scheduling";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { type EntryDeps, sched, writeRefusal } from "./live-entries.ts";

/**
 * live-invitations — a host seating people on their own `/calendar` entry, and the reader asking what
 * a span would collide with.
 *
 * Both run AS THE CALLER. `scheduling.invite_to_event` and `scheduling.withdraw_invitation` are DEFINER
 * doors that judge the caller themselves, because a seat and the notice announcing it have to land in
 * one transaction and `comms.fn_notify` is reachable only from a definer context. So there is no rule
 * here: a refusal is the door's own sentence, through {@link writeRefusal}. Answering an invitation
 * is not here either, because it is an RSVP (`live-coordination-writes.ts`).
 */

type Caller = ReadActor & { accessToken: string };

const REREAD = "The invitation was saved, but the entry could not be read back.";

/** The entry as the host's agenda now draws it, its new roster included. */
async function reread(
	eventId: string,
	deps: EntryDeps,
): Promise<ServiceResult<{ event: CalendarEvent }>> {
	const [event] = await deps.reread([eventId]);
	return event ? ok({ event }) : fail(500, { message: REREAD });
}

/** Seat people on one of the caller's own entries. Somebody already seated is left as they are. */
export async function inviteToEvent(
	input: InviteInput,
	deps: EntryDeps,
): Promise<ServiceResult<{ event: CalendarEvent }>> {
	const { error } = await sched(deps.db).rpc("invite_to_event", {
		p_event: input.eventId,
		p_users: input.userIds,
	});
	return error ? writeRefusal(error) : await reread(input.eventId, deps);
}

/** Withdraw one invitation from one of the caller's own entries. */
export async function withdrawInvitation(
	input: WithdrawInviteInput,
	deps: EntryDeps,
): Promise<ServiceResult<{ event: CalendarEvent }>> {
	const { error } = await sched(deps.db).rpc("withdraw_invitation", {
		p_event: input.eventId,
		p_attendee: input.attendeeId,
	});
	return error ? writeRefusal(error) : await reread(input.eventId, deps);
}

/** One row of `scheduling.fn_detect_event_clashes`, timestamps as ISO text. */
interface ClashRow {
	kind: EventClashKind;
	id: string;
	title: string;
	startsAt: string;
	endsAt: string;
}

/** What already holds the caller's own time across a span, earliest first. */
export async function readClashes(
	query: ClashQuery,
	actor: Caller,
	deps: EntryDeps,
): Promise<ServiceResult<EventClashVerdict>> {
	const { data, error } = await sched(deps.db).rpc("fn_detect_event_clashes", {
		p_user_id: actor.userId,
		p_starts_at: new Date(query.start).toISOString(),
		p_ends_at: new Date(query.end).toISOString(),
		p_exclude_event_id: query.excludeEventId ?? null,
	});
	if (error) throw new Error(`scheduling.fn_detect_event_clashes failed: ${error.message}`);
	const clashes: EventClash[] = ((data ?? []) as ClashRow[]).map((row) => ({
		kind: row.kind,
		id: row.id,
		title: row.title.slice(0, 200),
		start: Date.parse(row.startsAt),
		end: Date.parse(row.endsAt),
	}));
	return ok({ clashes });
}
