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

/** {@link iso}, or `null` for an instant no date can hold — which `toISOString` would throw on. */
function isoOrNull(at: number): string | null {
	const d = new Date(at);
	return Number.isFinite(d.getTime()) ? d.toISOString() : null;
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

/**
 * Append one history line, dated by the DATABASE's clock (the column default).
 *
 * `close_reschedule_round` writes its closing line the same way, from inside Postgres. Dating the lines
 * this module writes from the application's clock instead put two clocks into one ordered log: a vote
 * and the round closing on it are milliseconds apart, and an application host running a little ahead
 * of the database listed the result before the ballot that decided it.
 */
async function logLine(
	eventId: string,
	kind: string,
	actorId: string | null,
	summary: string,
	detail: string | null,
	targetId: string | null,
): Promise<void> {
	const { error } = await sched().from("event_history").insert({
		event_id: eventId,
		kind,
		actor_user_id: actorId,
		summary: summary.slice(0, 200),
		detail: detail ? detail.slice(0, 400) : null,
		target_id: targetId ? targetId.slice(0, 120) : null,
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
		);
	}
	return null;
}
// #endregion

// #region Reschedule
/**
 * `fn_guard_reschedule_write` (`00001510`) refuses a proposal, an approval or a vote on a round that
 * is no longer open, under the same row lock the cap counts under. The planner already refused a
 * closed round; this is the race it could not see — the round closed between the reader's read and
 * this write.
 */
const ROUND_NOT_OPEN = "55000";

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

/**
 * Close the round through the one atomic door (round + event move + log line).
 *
 * `close_reschedule_round` answers NULL when the round was already closed — ordinarily somebody else
 * got there first. But a vote is settled by whoever reads it next once it is decided, so the second
 * closer is often a reader who recorded EXACTLY the outcome this write was about to record: the last
 * ballot lands, a colleague's page load settles the vote a moment before this request's own close, and
 * the voter was told "somebody else changed this" about a vote that counted and a result that stands.
 * So a NULL re-reads the round, and the same ending (the same status, the same winner) is a success.
 */
async function closeRound(
	roundId: string,
	next: EventReschedule,
	actorId: string | null,
	summary: string,
	detail: string | null,
): Promise<PlanRefusal | null> {
	const winner = next.status === "resolved" ? next.resolvedProposalId : null;
	const { data, error } = await getServiceClient().schema("scheduling").rpc(
		"close_reschedule_round",
		{
			p_reschedule_id: roundId,
			p_status: next.status,
			p_resolved_proposal_id: winner,
			p_actor: actorId,
			p_summary: summary,
			p_detail: detail,
		},
	);
	if (error) return failed("closing a reschedule round", error.message);
	if (data !== null) return null;

	const { data: row, error: readError } = await sched().from("event_reschedules")
		.select("status, resolved_proposal_id")
		.eq("id", roundId)
		.maybeSingle();
	if (readError) return failed("re-reading a closed reschedule round", readError.message);
	const closed = row as { status: string; resolved_proposal_id: string | null } | null;
	if (closed && closed.status === next.status && (closed.resolved_proposal_id ?? null) === winner) {
		return null;
	}
	return conflict();
}

/**
 * Persist one accepted reschedule move.
 *
 * `loaded.roundId` is the latest round's row; a `propose` that opens a new round (the first ever, or
 * one after a closed round) inserts it. Proposal ids in the plan are the database's own uuids for
 * everything already on the ballot, which is what `approve`, `vote` and `confirm` address.
 *
 * **One statement per step wherever the step is one fact.** A proposal, an approval and a vote are
 * each a single row write; the round's deadline follows from them inside the same statement
 * (`fn_guard_reschedule_write` re-stamps it under the round lock), so no step can commit its row and
 * then answer 409 because a second, separate deadline write lost a race. The only two-statement step
 * is a proposal that opens a new round, and everything that could fail it is checked before the
 * round is inserted.
 */
export async function writeReschedule(
	actor: ReadActor,
	loaded: LoadedEvent,
	plan: ReschedulePlan,
	now: number,
): Promise<PlanRefusal | null> {
	// The read decided a vote it could not record. Acting now would be acting on a state the database
	// does not hold — a proposal would open the next round and leave the decided one `voting` forever
	// — so the move waits for a read that can write the decision down.
	if (loaded.unsettled) {
		console.error(
			"scheduling: refusing a reschedule move over an unrecorded settlement",
			loaded.event.id,
		);
		return {
			ok: false,
			status: 503,
			message:
				"This vote has just closed and its result is still being saved. Please try again in a moment.",
		};
	}

	const { before, next, step } = plan;
	const eventId = loaded.event.id;
	const tz = loaded.tz;
	const slotOf = (proposalId: string) => before.proposals.find((p) => p.id === proposalId);

	switch (step.kind) {
		case "propose": {
			// Built before anything is written: a slot outside the range a date can hold throws here, and
			// throwing after the round insert would leave an empty round nobody asked for.
			const startsAt = isoOrNull(step.start);
			const endsAt = isoOrNull(step.end);
			if (!startsAt || !endsAt) {
				return {
					ok: false,
					status: 422,
					message: "Give the alternative time a start and an end.",
					errors: { start: "That time is out of range." },
				};
			}

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
					starts_at: startsAt,
					ends_at: endsAt,
					proposed_by_user_id: actor.userId,
					proposed_by_role: step.role,
					approved: step.approved,
					note: step.note,
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
			// `fn_cap_reschedule_proposals` counts under a lock on the round, so this is the race the
			// planner could not see: two offers made against the same eleven-slot round, one of which took
			// the last place first.
			if (inserted.error?.code === "23514") {
				return {
					ok: false,
					status: 409,
					reason: "ballot_full",
					message: RESCHEDULE_REFUSAL_COPY.ballot_full,
				};
			}
			if (inserted.error?.code === ROUND_NOT_OPEN) return conflict();
			if (inserted.error || !inserted.data) {
				return failed("recording a proposal", inserted.error?.message ?? "no row");
			}
			const proposalId = (inserted.data as { id: string }).id;

			await logLine(
				eventId,
				"proposal",
				actor.userId,
				`Proposed ${slotLabel(step.start, tz)}`,
				step.note ?? (step.approved ? null : "Waiting on the host to approve this time."),
				proposalId,
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
			if (error?.code === ROUND_NOT_OPEN) return conflict();
			if (error) return failed("approving a proposal", error.message);
			if (!data || data.length === 0) return conflict();
			const slot = slotOf(step.proposalId);
			await logLine(
				eventId,
				"proposal",
				actor.userId,
				slot ? `Approved ${slotLabel(slot.start, tz)}` : "Approved a proposed time",
				null,
				step.proposalId,
			);
			return null;
		}

		case "open": {
			if (!loaded.roundId) return conflict();
			// The deadline is stamped by the round's own trigger as it turns `voting`, from the ballot it
			// holds at that instant — not from the ballot this request read.
			const refused = await updateRound(loaded.roundId, before, { status: next.status }, now);
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
			);
			return null;
		}

		case "vote": {
			if (!loaded.roundId) return conflict();
			const { error } = await sched().from("proposal_votes").insert({
				reschedule_id: loaded.roundId,
				proposal_id: step.proposalId,
				attendee_id: step.attendeeId,
			});
			if (error?.code === "23505") {
				return {
					ok: false,
					status: 409,
					reason: "duplicate_vote",
					message: RESCHEDULE_REFUSAL_COPY.duplicate_vote,
				};
			}
			if (error?.code === ROUND_NOT_OPEN) {
				return {
					ok: false,
					status: 409,
					reason: "vote_closed",
					message: RESCHEDULE_REFUSAL_COPY.vote_closed,
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
			await logLine(eventId, "proposal", actor.userId, "Withdrew the reschedule", null, null);
			return null;
		}
	}
}
// #endregion
