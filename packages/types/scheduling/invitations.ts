import { z } from "zod";
import type { RsvpResponse } from "./coordination.ts";
import { entryClassOf } from "./reminders.ts";
import { uuid } from "./rows.ts";
import {
	type CalendarEvent,
	type RsvpInput,
	RsvpInputSchema,
	SLOT_EPOCH_MAX_MS,
} from "./scheduling.ts";

/**
 * invitations — being asked to an entry, and what an entry would collide with.
 *
 * An invitation is an `EventAttendee` seat, not a thing of its own: `pending` until its person answers
 * through the same RSVP door every seat uses (`./coordination.ts`). This file holds the two questions
 * only `/calendar` asks of a seat, "is this waiting on the reader?" and "does this clash with what
 * they already hold?", as pure rules, so the lane, the grid, the inspector and the server agree.
 *
 * **What holds time.** {@link holdsViewerTime} is `scheduling.fn_detect_event_clashes` for the entries
 * a page already carries. The SQL exists as well because a page is a window: the modal asks it about a
 * date the page never loaded, and it also sees blackouts and calls. The two have to agree, so a seat
 * the reader has not accepted holds nothing, and an entry they left `passive` is open to be booked over.
 */

// #region Invitations
/**
 * The most seats an entry takes, the host's included: the one brake on an invitation being a doorbell.
 * `scheduling.invite_to_event` holds the same figure, and `coordination.contract.test.ts` pins the two.
 */
export const EVENT_ROSTER_MAX = 50;

/** The reader's own answer to an entry they were asked to: an {@link RsvpResponse} by another name. */
export type AttendeeStatus = RsvpResponse;

/** Answering an invitation is one RSVP, through the one door a seat answers by. */
export const RespondToInviteInput = RsvpInputSchema;
export type RespondToInviteInput = RsvpInput;

/** Seat people on one of the caller's own entries: accounts by id, anybody else by address. */
export const InviteInputSchema = z.object({
	eventId: uuid,
	userIds: z.array(uuid).max(EVENT_ROSTER_MAX).default([]),
	emails: z.array(z.string().trim().toLowerCase().email().max(320)).max(EVENT_ROSTER_MAX).default(
		[],
	),
}).refine((input) => input.userIds.length + input.emails.length > 0);
export type InviteInput = z.infer<typeof InviteInputSchema>;

/** Withdraw one invitation from one of the caller's own entries. */
export const WithdrawInviteInputSchema = z.object({ eventId: uuid, attendeeId: uuid });
export type WithdrawInviteInput = z.infer<typeof WithdrawInviteInputSchema>;

type Invited = Pick<CalendarEvent, "userAttendeeStatus" | "kind" | "callId" | "status">;

/**
 * Was the reader ASKED to this entry? A paid seat on a sitting or a booking is bought rather than
 * offered, and a call is answered through its own lifecycle, so neither is an invitation even while
 * its seat reads `pending`.
 */
function isInvitation(e: Invited): boolean {
	return !!e.userAttendeeStatus && e.kind !== "session" && e.kind !== "booking" && !e.callId;
}

/** Is this invitation waiting on the reader's answer? Drawn as a ghost until it is given. */
export function awaitsAnswer(e: Invited): boolean {
	return isInvitation(e) && e.userAttendeeStatus === "pending" && e.status !== "cancelled";
}

/** Did the reader turn this invitation down? It leaves their calendar, though not their reach. */
export function isDeclinedInvitation(e: Invited): boolean {
	return isInvitation(e) && e.userAttendeeStatus === "rejected";
}
// #endregion

// #region Clashes
/** What an entry can clash with: all three hold time, but only an event has a page to go to. */
export const EventClashKind = z.enum(["event", "call", "blackout"]);
export type EventClashKind = z.infer<typeof EventClashKind>;

/** One thing already holding the time in question. Times are epoch ms (UTC). */
export const EventClashSchema = z.object({
	kind: EventClashKind,
	id: z.string().min(1).max(120),
	title: z.string().max(200),
	start: z.number().int(),
	end: z.number().int(),
});
export type EventClash = z.infer<typeof EventClashSchema>;

/** What a span would collide with, earliest first. Empty is the all-clear. */
export const EventClashVerdictSchema = z.object({ clashes: z.array(EventClashSchema) });
export type EventClashVerdict = z.infer<typeof EventClashVerdictSchema>;

/** The span `GET /api/scheduling/clashes` is asked about, and the entry being moved, if any. */
export const ClashQuerySchema = z.object({
	start: z.number().int().min(0).max(SLOT_EPOCH_MAX_MS),
	end: z.number().int().min(0).max(SLOT_EPOCH_MAX_MS),
	excludeEventId: uuid.optional(),
});
export type ClashQuery = z.infer<typeof ClashQuerySchema>;

/** What a clash test reads of an entry. */
export type ClashEntry = Pick<
	CalendarEvent,
	| "id"
	| "title"
	| "kind"
	| "status"
	| "start"
	| "end"
	| "masked"
	| "callId"
	| "availabilityBehavior"
	| "userAttendeeStatus"
	| "clashCount"
>;

/** Could this entry hold time at all, whoever's answer it is waiting on? A moment cannot. */
function hasTimeToHold(e: ClashEntry): boolean {
	return e.status !== "cancelled" && e.kind !== "availability" &&
		e.availabilityBehavior !== "passive" && entryClassOf(e) === "event";
}

/**
 * Is the reader's time taken by this entry? An unanswered invitation does not take it yet, and a
 * declined one never will, while `tentative` does, matching `scheduling.fn_event_holders`.
 */
export function holdsViewerTime(e: ClashEntry): boolean {
	return hasTimeToHold(e) && e.userAttendeeStatus !== "pending" &&
		e.userAttendeeStatus !== "rejected";
}

function toClash(e: ClashEntry): EventClash {
	return {
		kind: e.callId ? "call" : "event",
		id: e.id,
		// A masked entry has only its privacy-safe word, here as everywhere.
		title: e.masked ? "Busy" : e.title,
		start: e.start,
		end: e.end,
	};
}

/**
 * What `span` would collide with among `existingEvents`, earliest first. Both edges are open, so back
 * to back is not a clash. `excludeId` leaves out the entry being moved, which cannot clash with itself.
 */
export function detectTimeClash(
	span: { start: number; end: number; excludeId?: string },
	existingEvents: readonly ClashEntry[],
): EventClashVerdict {
	if (span.end <= span.start) return { clashes: [] };
	const clashes = existingEvents
		.filter((e) =>
			e.id !== span.excludeId && holdsViewerTime(e) && e.start < span.end && e.end > span.start
		)
		.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
		.map(toClash);
	return { clashes };
}

/**
 * Stamp each entry with how much it clashes with, for the rows that show a warning.
 *
 * An unanswered invitation is counted, because that is the moment the answer is useful; a held entry
 * does not count one against itself, because nothing is taken until it is accepted. One pass over the
 * sorted spans rather than {@link detectTimeClash} per entry, since this runs on every agenda change.
 * An entry whose count did not change keeps its identity.
 */
export function withClashCounts<T extends ClashEntry>(events: readonly T[]): T[] {
	const held = events.filter(holdsViewerTime).sort((a, b) => a.start - b.start);
	return events.map((e) => {
		let count = 0;
		if (hasTimeToHold(e) && e.userAttendeeStatus !== "rejected") {
			for (const h of held) {
				if (h.start >= e.end) break;
				if (h.end > e.start && h.id !== e.id) count++;
			}
		}
		return count === (e.clashCount ?? 0) ? e : { ...e, clashCount: count };
	});
}
// #endregion
