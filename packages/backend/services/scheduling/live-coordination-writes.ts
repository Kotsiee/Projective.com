import type { SupabaseClient } from "supabaseClient";
import type {
	EventAttendee,
	EventReschedule,
	RsvpInput,
	RsvpResponse,
} from "@projective/types/scheduling";
import { RESCHEDULE_REFUSAL_COPY } from "@projective/types/scheduling";
import { getServiceClient } from "../../core/supabase.ts";
import type { ReadActor } from "../read-actor.ts";
import type { LoadedEvent } from "./live-calendar.ts";
import { slotLabel } from "./live-calendar.ts";
import type { PlanRefusal, ReschedulePlan } from "./coordination-plan.ts";

/**
 * live-coordination-writes — persisting an RSVP or a reschedule move that the rules have ALREADY
 * accepted (`./coordination-plan.ts`).
 *
 * Every write here runs as the SERVICE ROLE, because the six coordination tables carry no client
 * write policy at all (`00002015`): a negotiation's rules have one implementation, in TypeScript, and
 * a direct PostgREST write would bypass every one of them. So this module is the only door, and it
 * opens only for a plan the rules produced from an event the READER could see (the caller re-read
 * it through `readCalendarEvent`, under the reader's own RLS, before planning). Nothing here decides
 * whether a move is allowed; it decides only how to write one down.
 *
 * **Concurrency.** Two parties can act on one negotiation at once. Each write is conditioned on the
 * state the plan was made against — a round update matches its `status` as it was read, a vote rests
 * on `uq_one_vote_per_attendee_per_round`, closing a round on `close_reschedule_round`'s own open-status
 * guard — so a move made against a state that has since changed fails with a 409 the surface can
 * explain, rather than landing on top of the other party's.
 *
 * **The log.** Every accepted move writes one `scheduling.event_history` line, named in the ACTOR's
 * own zone with the zone written into the line (`slotLabel`), because a persisted line is read by
 * every party in theirs.
 */

// #region Plumbing
const OPEN_STATUSES = ["collecting", "awaiting_counterparty", "voting"];

/** The verb a history line records for an answer. Clearing an answer records nothing — see below. */
const RSVP_SUMMARY: Record<Exclude<RsvpResponse, "pending">, string> = {
	accepted: "Marked Going",
	rejected: "Marked Not going",
	tentative: "Marked Maybe",
};

function sched(): SupabaseClient {
	return getServiceClient().schema("scheduling") as unknown as SupabaseClient;
}

function iso(at: number): string {
	return new Date(at).toISOString();
}

/** A refusal for a write whose premise changed underneath it. */
function conflict(): PlanRefusal {
	return {
		ok: false,
		status: 409,
		message: "Somebody else changed this just now. Reopen it to see where it stands.",
	};
}

/** A failed write, as a refusal a route can answer with. */
function failed(what: string, message: string): PlanRefusal {
	console.error(`scheduling: ${what} failed`, message);
	return { ok: false, status: 503, message: "That change could not be saved. Please try again." };
}

async function logLine(
	eventId: string,
	kind: string,
	actorId: string | null,
	summary: string,
	detail: string | null,
	targetId: string | null,
	at: number,
): Promise<void> {
	const { error } = await sched().from("event_history").insert({
		event_id: eventId,
		kind,
		actor_user_id: actorId,
		summary: summary.slice(0, 200),
		detail: detail ? detail.slice(0, 400) : null,
		target_id: targetId ? targetId.slice(0, 120) : null,
		occurred_at: iso(at),
	});
	// The move has already been made; a log line that could not be written is logged, not rolled back.
	if (error) console.error("scheduling: history line not written", eventId, error.message);
}
// #endregion

// #region RSVP
/**
 * Record the reader's own answer on their own seat.
 *
 * The note is kept when the payload carries none — the modal's answer buttons send a response and no
 * note, and changing "Maybe — joining late" to "Going" should not silently erase what the attendee
 * said. An explicitly empty note clears it.
 *
 * Returning to `pending` clears the answer instant (`ck_attendee_pending_unanswered`) and writes no
 * log line: nobody "marked" anything, they withdrew an answer, and a line claiming otherwise would be
 * false. Restating the answer already given writes no line either.
 */
export async function writeRsvp(
	actor: ReadActor,
	loaded: LoadedEvent,
	seat: EventAttendee,
	input: RsvpInput,
	now: number,
): Promise<PlanRefusal | null> {
	const note = input.note === undefined ? seat.note : (input.note.trim() || null);
	const { data, error } = await sched().from("event_attendees")
		.update({
			response: input.response,
			responded_at: input.response === "pending" ? null : iso(now),
			note,
			updated_at: iso(now),
		})
		.eq("id", seat.id)
		.eq("event_id", loaded.event.id)
		.eq("user_id", actor.userId)
		.select("id");
	if (error) return failed("rsvp", error.message);
	if (!data || data.length === 0) return conflict();

	if (input.response !== "pending" && input.response !== seat.response) {
		await logLine(
			loaded.event.id,
			"rsvp",
			actor.userId,
			RSVP_SUMMARY[input.response],
			note,
			seat.id,
			now,
		);
	}
	return null;
}
// #endregion

// #region Reschedule
/** Update the round, conditioned on the status the plan was made against. */
async function updateRound(
	roundId: string,
	before: EventReschedule,
	patch: Record<string, unknown>,
	now: number,
): Promise<PlanRefusal | null> {
	const { data, error } = await sched().from("event_reschedules")
		.update({ ...patch, updated_at: iso(now) })
		.eq("id", roundId)
		.eq("status", before.status)
		.select("id");
	if (error) return failed("reschedule round update", error.message);
	if (!data || data.length === 0) return conflict();
	return null;
}

/** Close the round through the one atomic door (round + event move + log line). */
async function closeRound(
	roundId: string,
	next: EventReschedule,
	actorId: string | null,
	summary: string,
	detail: string | null,
): Promise<PlanRefusal | null> {
	const { data, error } = await getServiceClient().schema("scheduling").rpc(
		"close_reschedule_round",
		{
			p_reschedule_id: roundId,
			p_status: next.status,
			p_resolved_proposal_id: next.status === "resolved" ? next.resolvedProposalId : null,
			p_actor: actorId,
			p_summary: summary,
			p_detail: detail,
		},
	);
	if (error) return failed("closing a reschedule round", error.message);
	return data === null ? conflict() : null;
}

/**
 * Persist one accepted reschedule move.
 *
 * `loaded.roundId` is the latest round's row; a `propose` that opens a new round (the first ever, or
 * one after a closed round) inserts it. Proposal ids in the plan are the database's own uuids for
 * everything already on the ballot, which is what `approve`, `vote` and `confirm` address.
 */
export async function writeReschedule(
	actor: ReadActor,
	loaded: LoadedEvent,
	plan: ReschedulePlan,
	now: number,
): Promise<PlanRefusal | null> {
	const { before, next, step } = plan;
	const eventId = loaded.event.id;
	const tz = loaded.tz;
	const slotOf = (proposalId: string) => before.proposals.find((p) => p.id === proposalId);

	switch (step.kind) {
		case "propose": {
			let roundId = loaded.roundId;
			if (step.newRound || !roundId) {
				const { data, error } = await sched().from("event_reschedules")
					.insert({
						event_id: eventId,
						round: step.round,
						mode: next.mode,
						status: "collecting",
						opened_by_user_id: actor.userId,
						opened_at: iso(now),
					})
					.select("id")
					.single();
				// Two parties opening the same round at once: the unique (event, round) key decides, and the
				// loser is told the negotiation moved rather than given a second round zero.
				if (error?.code === "23505") return conflict();
				if (error || !data) return failed("opening a reschedule round", error?.message ?? "no row");
				roundId = (data as { id: string }).id;
			}

			const inserted = await sched().from("reschedule_proposals")
				.insert({
					reschedule_id: roundId,
					starts_at: iso(step.start),
					ends_at: iso(step.end),
					proposed_by_user_id: actor.userId,
					proposed_by_role: step.role,
					approved: step.approved,
					note: step.note,
					proposed_at: iso(now),
				})
				.select("id")
				.single();
			if (inserted.error?.code === "23505") {
				return {
					ok: false,
					status: 409,
					message: "That time is already on the table.",
					errors: { start: "That time has already been proposed." },
				};
			}
			if (inserted.error || !inserted.data) {
				return failed("recording a proposal", inserted.error?.message ?? "no row");
			}
			const proposalId = (inserted.data as { id: string }).id;

			// On a LIVE ballot a new host slot can bring the earliest option — and so the deadline —
			// forward. The deadline is a function of the ballot and is re-stamped with it.
			if (!step.newRound && loaded.roundId && before.status === "voting") {
				const refused = await updateRound(roundId, before, {
					resolves_at: next.resolvesAt === null ? null : iso(next.resolvesAt),
				}, now);
				if (refused) return refused;
			}

			await logLine(
				eventId,
				"proposal",
				actor.userId,
				`Proposed ${slotLabel(step.start, tz)}`,
				step.note ?? (step.approved ? null : "Waiting on the host to approve this time."),
				proposalId,
				now,
			);
			return null;
		}

		case "approve": {
			if (!loaded.roundId) return conflict();
			const { data, error } = await sched().from("reschedule_proposals")
				.update({ approved: true })
				.eq("id", step.proposalId)
				.eq("reschedule_id", loaded.roundId)
				.select("id");
			if (error) return failed("approving a proposal", error.message);
			if (!data || data.length === 0) return conflict();
			if (before.status === "voting") {
				const refused = await updateRound(loaded.roundId, before, {
					resolves_at: next.resolvesAt === null ? null : iso(next.resolvesAt),
				}, now);
				if (refused) return refused;
			}
			const slot = slotOf(step.proposalId);
			await logLine(
				eventId,
				"proposal",
				actor.userId,
				slot ? `Approved ${slotLabel(slot.start, tz)}` : "Approved a proposed time",
				null,
				step.proposalId,
				now,
			);
			return null;
		}

		case "open": {
			if (!loaded.roundId) return conflict();
			const refused = await updateRound(loaded.roundId, before, {
				status: next.status,
				resolves_at: next.resolvesAt === null ? null : iso(next.resolvesAt),
			}, now);
			if (refused) return refused;
			const ballot = next.proposals.filter((p) => p.proposedByRole === "host" || p.approved).length;
			await logLine(
				eventId,
				"proposal",
				actor.userId,
				next.mode === "vote"
					? `Opened a vote on ${ballot} times`
					: "Asked for a new time to be confirmed",
				next.mode === "vote" && next.resolvesAt !== null
					? `Voting closes ${slotLabel(next.resolvesAt, tz)}.`
					: null,
				null,
				now,
			);
			return null;
		}

		case "vote": {
			if (!loaded.roundId) return conflict();
			const { error } = await sched().from("proposal_votes").insert({
				reschedule_id: loaded.roundId,
				proposal_id: step.proposalId,
				attendee_id: step.attendeeId,
				cast_at: iso(now),
			});
			if (error?.code === "23505") {
				return {
					ok: false,
					status: 409,
					reason: "duplicate_vote",
					message: RESCHEDULE_REFUSAL_COPY.duplicate_vote,
				};
			}
			if (error) return failed("casting a vote", error.message);
			const slot = slotOf(step.proposalId);
			await logLine(
				eventId,
				"vote",
				actor.userId,
				slot ? `Voted for ${slotLabel(slot.start, tz)}` : "Voted",
				null,
				step.proposalId,
				now,
			);
			// The last eligible ballot decides the question there and then; that is nobody's act, so the
			// closing line carries no actor.
			if (next.status === "resolved" || next.status === "lapsed") {
				const winner = next.proposals.find((p) => p.id === next.resolvedProposalId);
				return await closeRound(
					loaded.roundId,
					next,
					null,
					winner ? `Moved to ${slotLabel(winner.start, tz)}` : "Vote closed without a majority",
					winner ? "Carried by a majority of the attendees." : "The original time stands.",
				);
			}
			return null;
		}

		case "confirm": {
			if (!loaded.roundId) return conflict();
			const slot = slotOf(step.proposalId);
			return await closeRound(
				loaded.roundId,
				next,
				actor.userId,
				slot ? `Moved to ${slotLabel(slot.start, tz)}` : "Moved to the confirmed time",
				before.mode === "vote"
					? "Confirmed once a majority had carried it."
					: "Confirmed by the other party.",
			);
		}

		case "withdraw": {
			if (!loaded.roundId) return conflict();
			const { data, error } = await sched().from("event_reschedules")
				.update({ status: "withdrawn", resolves_at: null, updated_at: iso(now) })
				.eq("id", loaded.roundId)
				.in("status", OPEN_STATUSES)
				.select("id");
			if (error) return failed("withdrawing a reschedule", error.message);
			if (!data || data.length === 0) return conflict();
			await logLine(eventId, "proposal", actor.userId, "Withdrew the reschedule", null, null, now);
			return null;
		}
	}
}
// #endregion
