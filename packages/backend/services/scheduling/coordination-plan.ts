import type {
	CalendarEvent,
	EventAttendee,
	EventReschedule,
	RescheduleInput,
	RescheduleMode,
	RescheduleProposal,
	RescheduleRefusalReason,
	RsvpInput,
	SchedulingParty,
	SchedulingViewer,
} from "@projective/types/scheduling";
import {
	ballotProposals,
	canOpenVote,
	canReschedule,
	eligibleVoterCount,
	eventLiveStatus,
	isEventParty,
	isProposalOnBallot,
	isRescheduleClosed,
	majorityProposal,
	rescheduleModeFor,
	settleVote,
	viewerAttendee,
	voteIsOpen,
	voteResolvesAt,
} from "@projective/types/scheduling";

/**
 * coordination-plan — what one RSVP or one reschedule move WOULD do to an event, decided without
 * touching anything.
 *
 * The rules are the SSOT's own pure predicates ({@link canReschedule}, {@link canOpenVote},
 * {@link isProposalOnBallot}, {@link voteIsOpen}, {@link majorityProposal}, {@link settleVote}); this
 * module only APPLIES them to an event and a move, and answers with either a refusal carrying its
 * machine-readable reason or the negotiation's next state plus the one step that gets it there. The
 * step is what the writer persists; the next state is what a reader would see afterwards.
 *
 * Kept apart from the IO on purpose. The rules decide commitments — who may move a meeting, when a
 * vote has carried — so they must be testable against a hand-built event, and a module that also
 * held a database client could only be tested against a database. It also means the service and the
 * writer cannot disagree about the rules: neither contains any.
 *
 * `now` is an argument, never a read of the clock, for the same reason.
 */

// #region Shapes
/** A move the rules refused, with the status a transport should answer it with. */
export interface PlanRefusal {
	ok: false;
	status: number;
	/** Machine-readable, so a surface explains a refusal without re-deriving it. */
	reason?: RescheduleRefusalReason;
	/** A sentence for a refusal the reason vocabulary has no member for. */
	message?: string;
	/** Field-keyed detail for a malformed payload. */
	errors?: Record<string, string>;
}

/** The one write a reschedule move needs, expressed as data rather than performed. */
export type RescheduleStep =
	| {
		kind: "propose";
		/** The round the slot lands in. */
		round: number;
		/** True when the move opens a new round rather than extending the current one. */
		newRound: boolean;
		start: number;
		end: number;
		role: "host" | "attendee";
		approved: boolean;
		note: string | null;
	}
	| { kind: "approve"; proposalId: string }
	| { kind: "open" }
	| { kind: "vote"; proposalId: string; attendeeId: string }
	| { kind: "confirm"; proposalId: string }
	| { kind: "withdraw" };

/** An accepted reschedule move: the state it starts from, the state it ends in, and the step. */
export interface ReschedulePlan {
	ok: true;
	/** The negotiation as it stood — settled first, so no move is judged against a finished vote. */
	before: EventReschedule;
	/** The negotiation afterwards. A `vote` whose ballot completes the electorate is already settled. */
	next: EventReschedule;
	step: RescheduleStep;
	/** Who acted, as the log line and the proposal will name them. */
	actor: SchedulingParty;
}

/** An accepted RSVP: the seat being answered for. */
export interface RsvpPlan {
	ok: true;
	seat: EventAttendee;
}
// #endregion

// #region Helpers
function refuse(status: number, reason: RescheduleRefusalReason): PlanRefusal {
	return { ok: false, status, reason };
}

/**
 * The negotiation an event starts from before anybody has asked to move it.
 *
 * The MODE is a property of the event's head count ({@link rescheduleModeFor}), never a choice the
 * opener makes — offering it as a switch would let a host put a two-person meeting to a "vote" of one.
 */
export function emptyReschedule(mode: RescheduleMode): EventReschedule {
	return {
		mode,
		status: "none",
		openedBy: null,
		openedAt: null,
		proposals: [],
		resolvesAt: null,
		resolvedProposalId: null,
		round: 0,
	};
}
// #endregion

// #region RSVP
/**
 * May the viewer answer this event, and from which seat?
 *
 * A viewer only ever answers for themselves: the seat is the roster row the SERVER marked
 * `isViewer`, never an id the caller supplied. A host is going by definition — they are running it —
 * so the host's seat is refused rather than letting them decline their own meeting. An answer to a
 * finished event is refused too: an RSVP is a statement about attending, and it cannot be made in the
 * past tense.
 */
export function planRsvp(
	event: CalendarEvent,
	_input: RsvpInput,
	now: number,
): RsvpPlan | PlanRefusal {
	const seat = viewerAttendee(event.roster ?? []);
	if (!seat || seat.role === "host") return refuse(403, "not_permitted");
	if (eventLiveStatus(now, event.start, event.end).state === "passed") {
		return refuse(409, "event_passed");
	}
	return { ok: true, seat };
}
// #endregion

// #region Reschedule
/**
 * Apply one move to an event's reschedule negotiation.
 *
 * **A round always has a way out.** `resolved`, `lapsed` and `withdrawn` all close the current round
 * to every action except `propose`, and `propose` on a closed round opens the NEXT one with a fresh
 * ballot — which is what makes withdrawing recoverable rather than a state nothing can leave.
 */
export function planReschedule(
	event: CalendarEvent,
	input: RescheduleInput,
	now: number,
	viewer: SchedulingViewer,
): ReschedulePlan | PlanRefusal {
	if (eventLiveStatus(now, event.start, event.end).state === "passed") {
		return refuse(409, "event_passed");
	}
	// Rule 1 — nothing moves inside the lockout, whoever is asking.
	if (!canReschedule(now, event.start)) return refuse(409, "inside_lockout");

	// Only a party to the event may touch its negotiation, and being a party is the server's own
	// seating rather than anything the caller asserted.
	if (!isEventParty(event, viewer)) return refuse(403, "not_permitted");
	// An event with no roster is not something people negotiate — a deadline, a private block.
	if (!event.roster) return refuse(403, "not_permitted");

	const isHost = event.viewerIsHost === true;
	const roster = event.roster;
	const me = viewerAttendee(roster);
	const voters = eligibleVoterCount(roster);

	// Settle before acting, so no action is ever evaluated against a vote whose question has already
	// finished being asked. Idempotent, and the same call the read path makes.
	const before = settleVote(
		now,
		event.reschedule ?? emptyReschedule(rescheduleModeFor(roster.length)),
		voters,
	);
	const closed = isRescheduleClosed(before.status);
	if (closed && input.action !== "propose") return refuse(409, "vote_closed");

	const actor: SchedulingParty = isHost
		? event.organiser ?? { name: "Host", avatar: null, handle: null }
		: me
		? { name: me.name, avatar: me.avatar, handle: me.handle }
		: { name: "Attendee", avatar: null, handle: null };

	switch (input.action) {
		case "propose": {
			if (input.start === undefined || input.end === undefined || input.end <= input.start) {
				return {
					ok: false,
					status: 422,
					message: "Give the alternative time a start and an end.",
					errors: { start: "An alternative slot needs a start and a later end." },
				};
			}
			// Rule 1 applies to the slot being OFFERED as well as the event being moved: a slot three hours
			// away would open a ballot whose own deadline had already passed.
			if (!canReschedule(now, input.start)) return refuse(422, "proposal_inside_lockout");
			// A slot identical to one already on this round would split the vote for a single time.
			if (
				!closed &&
				before.proposals.some((p) => p.start === input.start && p.end === input.end)
			) {
				return {
					ok: false,
					status: 409,
					message: "That time is already on the table.",
					errors: { start: "That time has already been proposed." },
				};
			}

			// A closed round is not extended, it is succeeded.
			const round = closed ? before.round + 1 : before.round;
			const carried = closed ? { ...emptyReschedule(before.mode), round } : before;
			// Rule 3 — a host's own slot is on the ballot immediately; an attendee's waits for approval.
			const proposal: RescheduleProposal = {
				id: `pending-r${round}p${carried.proposals.length}`,
				start: input.start,
				end: input.end,
				proposedBy: actor,
				proposedByRole: isHost ? "host" : "attendee",
				proposedAt: now,
				approved: isHost,
				note: input.note?.trim() || null,
				votes: [],
			};
			const proposals = [...carried.proposals, proposal];
			const next: EventReschedule = {
				...carried,
				proposals,
				status: carried.status === "none" ? "collecting" : carried.status,
				openedBy: carried.openedBy ?? actor,
				openedAt: carried.openedAt ?? now,
				// The deadline is a function of the ballot, so a new earliest slot brings it forward.
				resolvesAt: carried.status === "voting" ? voteResolvesAt(proposals) : carried.resolvesAt,
			};
			return {
				ok: true,
				before,
				next,
				actor,
				step: {
					kind: "propose",
					round,
					// A round that has never been written down (status `none`) is new too.
					newRound: closed || before.status === "none",
					start: input.start,
					end: input.end,
					role: proposal.proposedByRole,
					approved: proposal.approved,
					note: proposal.note,
				},
			};
		}

		case "approve": {
			if (!isHost) return refuse(403, "not_permitted");
			const target = before.proposals.find((p) => p.id === input.proposalId);
			if (!target) return refuse(404, "unknown_proposal");
			const proposals = before.proposals.map((p) =>
				p.id === target.id ? { ...p, approved: true } : p
			);
			return {
				ok: true,
				before,
				actor,
				next: {
					...before,
					proposals,
					resolvesAt: before.status === "voting" ? voteResolvesAt(proposals) : before.resolvesAt,
				},
				step: { kind: "approve", proposalId: target.id },
			};
		}

		case "open": {
			if (!isHost) return refuse(403, "not_permitted");
			// Rule 2 — a vote needs two slots on the ballot; a 1-on-1 needs one. On the BALLOT in both
			// cases: an attendee's slot the host has not approved cannot be put to anybody.
			if (
				before.mode === "vote"
					? !canOpenVote(before.proposals)
					: ballotProposals(before.proposals).length === 0
			) {
				return refuse(422, "not_enough_proposals");
			}
			if (before.status === "voting" || before.status === "awaiting_counterparty") {
				return {
					ok: false,
					status: 409,
					message: "This negotiation is already open.",
				};
			}
			if (before.mode === "vote" && !voteIsOpen(now, before.proposals)) {
				return refuse(409, "vote_closed");
			}
			const next: EventReschedule = before.mode === "vote"
				? {
					...before,
					status: "voting",
					resolvesAt: voteResolvesAt(before.proposals),
					openedBy: before.openedBy ?? actor,
					openedAt: before.openedAt ?? now,
				}
				: {
					...before,
					status: "awaiting_counterparty",
					resolvesAt: null,
					openedBy: before.openedBy ?? actor,
					openedAt: before.openedAt ?? now,
				};
			return { ok: true, before, next, actor, step: { kind: "open" } };
		}

		case "vote": {
			// The host authored the options; letting them vote too would be casting a ballot in their own
			// election.
			if (before.mode !== "vote" || before.status !== "voting") return refuse(409, "vote_closed");
			if (isHost || !me) return refuse(403, "not_permitted");
			const target = before.proposals.find((p) => p.id === input.proposalId);
			if (!target) return refuse(404, "unknown_proposal");
			if (!isProposalOnBallot(target)) return refuse(409, "proposal_not_approved");
			if (!voteIsOpen(now, before.proposals)) return refuse(409, "vote_closed");
			if (before.proposals.some((p) => p.votes.some((v) => v.attendeeId === me.id))) {
				return refuse(409, "duplicate_vote");
			}
			const proposals = before.proposals.map((p) =>
				p.id === target.id
					? { ...p, votes: [...p.votes, { ...actor, attendeeId: me.id, at: now }] }
					: p
			);
			// The last eligible ballot settles the question there and then — see `settleVote`.
			return {
				ok: true,
				before,
				actor,
				next: settleVote(now, { ...before, proposals }, voters),
				step: { kind: "vote", proposalId: target.id, attendeeId: me.id },
			};
		}

		case "confirm": {
			if (before.mode === "counterparty") {
				// The party who did NOT offer the time is the one who accepts it.
				if (isHost) return refuse(403, "not_permitted");
				const target = before.proposals.find((p) => p.id === input.proposalId);
				if (!target) return refuse(404, "unknown_proposal");
				if (!isProposalOnBallot(target)) return refuse(409, "proposal_not_approved");
				return {
					ok: true,
					before,
					actor,
					next: { ...before, status: "resolved", resolvedProposalId: target.id },
					step: { kind: "confirm", proposalId: target.id },
				};
			}
			// On a vote the HOST finalises, and only once a slot has actually carried: a majority is the
			// rule (PRODUCT_SPEC §The Proactive Calendar), so this closes a decided vote early rather than
			// deciding it.
			if (!isHost) return refuse(403, "not_permitted");
			if (before.status !== "voting") return refuse(409, "vote_closed");
			const winner = majorityProposal(before.proposals, voters);
			if (!winner) return refuse(409, "no_majority");
			// Naming a different slot is refused rather than ignored.
			if (input.proposalId && input.proposalId !== winner.id) return refuse(409, "no_majority");
			return {
				ok: true,
				before,
				actor,
				next: { ...before, status: "resolved", resolvedProposalId: winner.id },
				step: { kind: "confirm", proposalId: winner.id },
			};
		}

		case "withdraw": {
			if (!isHost) return refuse(403, "not_permitted");
			// Nothing has been asked yet, so there is nothing to take back.
			if (before.status === "none") {
				return { ok: false, status: 409, message: "There is no reschedule to withdraw." };
			}
			return {
				ok: true,
				before,
				actor,
				next: { ...before, status: "withdrawn", resolvesAt: null },
				step: { kind: "withdraw" },
			};
		}
	}
}
// #endregion
