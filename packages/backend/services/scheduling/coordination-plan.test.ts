import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type {
	CalendarEvent,
	EventAttendee,
	EventReschedule,
	RescheduleInput,
	RescheduleProposal,
	SchedulingViewer,
} from "@projective/types/scheduling";
import {
	ANONYMOUS_VIEWER,
	RESCHEDULE_PROPOSALS_MAX,
	voteResolvesAt,
} from "@projective/types/scheduling";
import {
	emptyReschedule,
	type PlanRefusal,
	planReschedule,
	planRsvp,
} from "./coordination-plan.ts";

/**
 * The coordination rules, applied to hand-built events.
 *
 * {@link planReschedule} and {@link planRsvp} are what stands between a caller and a write that moves
 * somebody's meeting, so each rule is pinned here against the smallest event that exercises it —
 * never against the seeded database, whose contents change with the seed and whose clock is the
 * wall clock. Every test fixes `now` and builds the event around it.
 */

// #region Builders
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A fixed instant every test measures from. */
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const MEMBER: SchedulingViewer = { authenticated: true, handle: null };

function seat(
	id: string,
	role: EventAttendee["role"],
	isViewer = false,
	response: EventAttendee["response"] = "pending",
): EventAttendee {
	return {
		id,
		name: `Seat ${id}`,
		avatar: null,
		handle: null,
		role,
		response,
		respondedAt: response === "pending" ? null : NOW - DAY,
		isViewer,
		note: null,
	};
}

function proposal(
	id: string,
	startsInHours: number,
	opts: { approved?: boolean; votes?: string[]; role?: "host" | "attendee" } = {},
): RescheduleProposal {
	const start = NOW + startsInHours * HOUR;
	return {
		id,
		start,
		end: start + HOUR,
		proposedBy: { name: "Host", avatar: null, handle: null },
		proposedByRole: opts.role ?? "host",
		proposedAt: NOW - HOUR,
		approved: opts.approved ?? true,
		note: null,
		votes: (opts.votes ?? []).map((attendeeId) => ({
			name: `Seat ${attendeeId}`,
			avatar: null,
			handle: null,
			attendeeId,
			at: NOW - HOUR,
		})),
	};
}

/**
 * An event starting `startsInHours` from {@link NOW}, with the given roster and negotiation.
 * `asHost` seats the viewer on the host row; otherwise the viewer is whichever row says so.
 */
function event(
	opts: {
		startsInHours?: number;
		roster?: EventAttendee[];
		reschedule?: EventReschedule;
		asHost?: boolean;
		callId?: string;
	} = {},
): CalendarEvent {
	const start = NOW + (opts.startsInHours ?? 72) * HOUR;
	return {
		id: "00000000-0000-4000-8000-000000000001",
		title: "Design crit",
		kind: "sync",
		start,
		end: start + HOUR,
		roster: opts.roster,
		reschedule: opts.reschedule,
		viewerIsHost: opts.asHost ?? false,
		organiser: { name: "Host", avatar: null, handle: null },
		callId: opts.callId,
	};
}

/** A group of five: one host and four participants, the viewer seated on `viewerSeat`. */
function groupRoster(viewerSeat: string | null): EventAttendee[] {
	return [
		seat("h", "host", viewerSeat === "h"),
		seat("a1", "participant", viewerSeat === "a1"),
		seat("a2", "participant", viewerSeat === "a2"),
		seat("a3", "participant", viewerSeat === "a3"),
		seat("a4", "participant", viewerSeat === "a4"),
	];
}

function input(action: RescheduleInput["action"], extra: Partial<RescheduleInput> = {}) {
	return { scope: "personal", eventId: "e", action, ...extra } as RescheduleInput;
}

function refused(result: unknown): PlanRefusal {
	const r = result as { ok: boolean };
	assert(!r.ok, `expected a refusal, got ${JSON.stringify(result)}`);
	return result as PlanRefusal;
}
// #endregion

// #region RSVP
Deno.test("rsvp — an invited seat may answer, and answers from its own row", () => {
	const ev = event({ roster: groupRoster("a2") });
	const plan = planRsvp(ev, { scope: "personal", eventId: "e", response: "accepted" }, NOW);
	assert(plan.ok);
	assertStrictEquals(plan.seat.id, "a2");
});

Deno.test("rsvp — the host, a stranger and a finished event are all refused", () => {
	const answer = { scope: "personal" as const, eventId: "e", response: "rejected" as const };

	// A host is going by definition: they are running it.
	assertEquals(
		refused(planRsvp(event({ roster: groupRoster("h"), asHost: true }), answer, NOW)).reason,
		"not_permitted",
	);
	// Nobody seated as the viewer: there is no row to answer on.
	assertEquals(
		refused(planRsvp(event({ roster: groupRoster(null) }), answer, NOW)).reason,
		"not_permitted",
	);
	// No roster at all — a deadline, a private block.
	assertEquals(refused(planRsvp(event(), answer, NOW)).reason, "not_permitted");

	// An RSVP is a statement about attending, and cannot be made in the past tense.
	const past = event({ roster: groupRoster("a1"), startsInHours: -3 });
	const r = refused(planRsvp(past, answer, NOW));
	assertEquals(r.reason, "event_passed");
	assertEquals(r.status, 409);
});
// #endregion

// #region Who may touch a negotiation
Deno.test("reschedule — a stranger, a guest and an unrostered entry are refused", () => {
	const propose = input("propose", { start: NOW + 96 * HOUR, end: NOW + 97 * HOUR });

	assertEquals(
		refused(planReschedule(event({ roster: groupRoster(null) }), propose, NOW, MEMBER)).reason,
		"not_permitted",
	);
	assertEquals(
		refused(planReschedule(event({ roster: groupRoster("a1") }), propose, NOW, ANONYMOUS_VIEWER))
			.reason,
		"not_permitted",
	);
	// A host of an entry with no people on it has nothing to negotiate with anybody.
	assertEquals(
		refused(planReschedule(event({ asHost: true }), propose, NOW, MEMBER)).reason,
		"not_permitted",
	);
});

Deno.test("reschedule — nothing moves inside the 12-hour lockout, and a finished event cannot move", () => {
	const propose = input("propose", { start: NOW + 96 * HOUR, end: NOW + 97 * HOUR });
	const soon = event({ roster: groupRoster("h"), asHost: true, startsInHours: 11 });
	assertEquals(refused(planReschedule(soon, propose, NOW, MEMBER)).reason, "inside_lockout");

	const done = event({ roster: groupRoster("h"), asHost: true, startsInHours: -2 });
	assertEquals(refused(planReschedule(done, propose, NOW, MEMBER)).reason, "event_passed");
});
// #endregion

// #region Proposing
Deno.test("reschedule — a slot inside its own lockout is refused, not put on a ballot", () => {
	const host = event({ roster: groupRoster("h"), asHost: true });
	const r = refused(
		planReschedule(
			host,
			input("propose", { start: NOW + 3 * HOUR, end: NOW + 4 * HOUR }),
			NOW,
			MEMBER,
		),
	);
	assertEquals(r.reason, "proposal_inside_lockout");
	assertEquals(r.status, 422);
});

Deno.test("reschedule — a proposal needs a start and a LATER end", () => {
	const host = event({ roster: groupRoster("h"), asHost: true });
	const r = refused(
		planReschedule(
			host,
			input("propose", { start: NOW + 96 * HOUR, end: NOW + 96 * HOUR }),
			NOW,
			MEMBER,
		),
	);
	assertEquals(r.status, 422);
	assert(r.errors?.start);
});

Deno.test("reschedule — a host's slot is on the ballot at once; an attendee's waits for approval", () => {
	const slot = input("propose", {
		start: NOW + 96 * HOUR,
		end: NOW + 97 * HOUR,
		note: "  after lunch  ",
	});

	const byHost = planReschedule(
		event({ roster: groupRoster("h"), asHost: true }),
		slot,
		NOW,
		MEMBER,
	);
	assert(byHost.ok);
	assert(byHost.step.kind === "propose");
	assertEquals(byHost.step.approved, true);
	assertEquals(byHost.step.role, "host");
	assertEquals(byHost.step.note, "after lunch");
	// The first proposal on an event nobody has asked to move opens the negotiation's first round.
	assertEquals(byHost.step.newRound, true);
	assertEquals(byHost.next.status, "collecting");

	const byAttendee = planReschedule(event({ roster: groupRoster("a3") }), slot, NOW, MEMBER);
	assert(byAttendee.ok);
	assert(byAttendee.step.kind === "propose");
	assertEquals(byAttendee.step.approved, false);
	assertEquals(byAttendee.step.role, "attendee");
});

Deno.test("reschedule — the same time twice in one round is refused rather than splitting the vote", () => {
	const open: EventReschedule = {
		...emptyReschedule("vote"),
		status: "collecting",
		round: 1,
		proposals: [proposal("p1", 96)],
	};
	const ev = event({ roster: groupRoster("h"), asHost: true, reschedule: open });
	const r = refused(
		planReschedule(
			ev,
			input("propose", { start: NOW + 96 * HOUR, end: NOW + 97 * HOUR }),
			NOW,
			MEMBER,
		),
	);
	assertEquals(r.status, 409);
	assert(r.errors?.start);
});

Deno.test("reschedule — a full round refuses every further slot; a closed one starts afresh", () => {
	// Twelve slots, one day apart, all well clear of the lockout — and one still waiting on the host,
	// because the cap counts what is on the TABLE, not only what is on the ballot.
	const twelve = Array.from(
		{ length: RESCHEDULE_PROPOSALS_MAX },
		(_, i) => proposal(`p${i}`, 96 + i * 24, i === 5 ? { approved: false, role: "attendee" } : {}),
	);
	const full: EventReschedule = {
		...emptyReschedule("vote"),
		status: "collecting",
		proposals: twelve,
	};
	const fresh = input("propose", { start: NOW + 500 * HOUR, end: NOW + 501 * HOUR });

	const r = refused(
		planReschedule(
			event({ roster: groupRoster("h"), asHost: true, reschedule: full }),
			fresh,
			NOW,
			MEMBER,
		),
	);
	assertEquals(r.reason, "ballot_full");
	assertEquals(r.status, 409);

	// An attendee meets the same wall — their slot would only wait on approval, but it would still
	// occupy a place the table does not have.
	assertEquals(
		refused(
			planReschedule(
				event({ roster: groupRoster("a2"), reschedule: full }),
				fresh,
				NOW,
				MEMBER,
			),
		).reason,
		"ballot_full",
	);

	// The cap is asked before the duplicate check: a full round is full whatever slot is offered.
	assertEquals(
		refused(
			planReschedule(
				event({ roster: groupRoster("h"), asHost: true, reschedule: full }),
				input("propose", { start: twelve[0].start, end: twelve[0].end }),
				NOW,
				MEMBER,
			),
		).reason,
		"ballot_full",
	);

	// A withdrawn round of twelve is succeeded, not extended — round 1 starts with one slot.
	const closedRound = planReschedule(
		event({
			roster: groupRoster("h"),
			asHost: true,
			reschedule: { ...full, status: "withdrawn" },
		}),
		fresh,
		NOW,
		MEMBER,
	);
	assert(closedRound.ok);
	assertEquals(closedRound.next.round, 1);
	assertEquals(closedRound.next.proposals.length, 1);
});
// #endregion

// #region Opening a vote
Deno.test("reschedule — the vote gate refuses one slot and admits two", () => {
	const one: EventReschedule = {
		...emptyReschedule("vote"),
		status: "collecting",
		round: 1,
		proposals: [proposal("p1", 96)],
	};
	const ev = (r: EventReschedule) =>
		event({ roster: groupRoster("h"), asHost: true, reschedule: r });

	assertEquals(
		refused(planReschedule(ev(one), input("open"), NOW, MEMBER)).reason,
		"not_enough_proposals",
	);

	// An attendee's slot the host has not approved is not on the ballot, so it does not count.
	const unapproved = {
		...one,
		proposals: [...one.proposals, proposal("p2", 120, { approved: false, role: "attendee" })],
	};
	assertEquals(
		refused(planReschedule(ev(unapproved), input("open"), NOW, MEMBER)).reason,
		"not_enough_proposals",
	);

	const two = { ...one, proposals: [...one.proposals, proposal("p2", 120)] };
	const plan = planReschedule(ev(two), input("open"), NOW, MEMBER);
	assert(plan.ok);
	assertEquals(plan.next.status, "voting");
	assertEquals(plan.next.resolvesAt, voteResolvesAt(two.proposals));

	// Only the host opens a vote.
	const asAttendee = event({ roster: groupRoster("a1"), reschedule: two });
	assertEquals(
		refused(planReschedule(asAttendee, input("open"), NOW, MEMBER)).reason,
		"not_permitted",
	);

	// And an open vote is not re-opened.
	const voting = { ...two, status: "voting" as const, resolvesAt: voteResolvesAt(two.proposals) };
	assertEquals(refused(planReschedule(ev(voting), input("open"), NOW, MEMBER)).status, 409);
});

Deno.test("reschedule — a 1-on-1 is not opened on a slot the host never approved", () => {
	const roster = [seat("h", "host", true), seat("c", "participant")];
	const r: EventReschedule = {
		...emptyReschedule("counterparty"),
		status: "collecting",
		round: 1,
		proposals: [proposal("p1", 96, { approved: false, role: "attendee" })],
	};
	const ev = event({ roster, asHost: true, reschedule: r });
	assertEquals(
		refused(planReschedule(ev, input("open"), NOW, MEMBER)).reason,
		"not_enough_proposals",
	);
});

Deno.test("reschedule — a 1-on-1 goes to its counterparty, not to a vote", () => {
	const roster = [seat("h", "host", true), seat("c", "participant")];
	const r: EventReschedule = {
		...emptyReschedule("counterparty"),
		status: "collecting",
		round: 1,
		proposals: [proposal("p1", 96)],
	};
	const plan = planReschedule(
		event({ roster, asHost: true, reschedule: r }),
		input("open"),
		NOW,
		MEMBER,
	);
	assert(plan.ok);
	assertEquals(plan.next.status, "awaiting_counterparty");
	assertStrictEquals(plan.next.resolvesAt, null);
});
// #endregion

// #region Voting and deciding
function votingRound(votes: Record<string, string[]>): EventReschedule {
	const proposals = [
		proposal("p1", 96, { votes: votes.p1 ?? [] }),
		proposal("p2", 120, { votes: votes.p2 ?? [] }),
	];
	return {
		...emptyReschedule("vote"),
		status: "voting",
		round: 1,
		proposals,
		resolvesAt: voteResolvesAt(proposals),
	};
}

Deno.test("reschedule — an attendee votes once, the host not at all", () => {
	const r = votingRound({ p1: ["a1"] });
	const vote = input("vote", { proposalId: "p1" });

	const plan = planReschedule(
		event({ roster: groupRoster("a2"), reschedule: r }),
		vote,
		NOW,
		MEMBER,
	);
	assert(plan.ok);
	assert(plan.step.kind === "vote");
	assertEquals(plan.step.attendeeId, "a2");

	assertEquals(
		refused(planReschedule(event({ roster: groupRoster("a1"), reschedule: r }), vote, NOW, MEMBER))
			.reason,
		"duplicate_vote",
	);
	assertEquals(
		refused(
			planReschedule(
				event({ roster: groupRoster("h"), asHost: true, reschedule: r }),
				vote,
				NOW,
				MEMBER,
			),
		)
			.reason,
		"not_permitted",
	);
	assertEquals(
		refused(
			planReschedule(
				event({ roster: groupRoster("a2"), reschedule: r }),
				input("vote", { proposalId: "nope" }),
				NOW,
				MEMBER,
			),
		).reason,
		"unknown_proposal",
	);
});

Deno.test("reschedule — the last outstanding ballot settles the question there and then", () => {
	// Four eligible voters; three have answered, and this is the fourth — so nothing is left to wait for.
	const r = votingRound({ p1: ["a1", "a2"], p2: ["a4"] });
	const plan = planReschedule(
		event({ roster: groupRoster("a3"), reschedule: r }),
		input("vote", { proposalId: "p1" }),
		NOW,
		MEMBER,
	);
	assert(plan.ok);
	assertEquals(plan.next.status, "resolved");
	assertEquals(plan.next.resolvedProposalId, "p1");
});

Deno.test("reschedule — a host finalises a vote that carried, and only one that has", () => {
	const host = (r: EventReschedule) =>
		event({ roster: groupRoster("h"), asHost: true, reschedule: r });

	// Two of four is not a majority.
	assertEquals(
		refused(planReschedule(host(votingRound({ p1: ["a1", "a2"] })), input("confirm"), NOW, MEMBER))
			.reason,
		"no_majority",
	);

	// Once every voter has answered the round is settled on read, so the host finds it already closed.
	const carried = votingRound({ p1: ["a1", "a2", "a3"], p2: ["a4"] });
	assertEquals(
		refused(planReschedule(host(carried), input("confirm"), NOW, MEMBER)).reason,
		"vote_closed",
	);

	// Naming a slot other than the winner is refused, not silently corrected. (A majority reached
	// before every voter answered is decided only by the host, so the round is still `voting` here.)
	const five = [...groupRoster("h"), seat("a5", "participant"), seat("a6", "participant")];
	const early = votingRound({ p1: ["a1", "a2", "a3", "a4"] });
	const ev = event({ roster: five, asHost: true, reschedule: early });
	const plan = planReschedule(ev, input("confirm"), NOW, MEMBER);
	assert(plan.ok);
	assertEquals(plan.next.status, "resolved");
	assertEquals(plan.next.resolvedProposalId, "p1");
	assertEquals(
		refused(planReschedule(ev, input("confirm", { proposalId: "p2" }), NOW, MEMBER)).reason,
		"no_majority",
	);

	// An attendee does not finalise a vote.
	const asAttendee = event({
		roster: [...groupRoster("a1"), seat("a5", "participant"), seat("a6", "participant")],
		reschedule: early,
	});
	assertEquals(
		refused(planReschedule(asAttendee, input("confirm"), NOW, MEMBER)).reason,
		"not_permitted",
	);
});

Deno.test("reschedule — in a 1-on-1 the counterparty accepts the offered time", () => {
	const roster = [seat("h", "host"), seat("c", "participant", true)];
	const r: EventReschedule = {
		...emptyReschedule("counterparty"),
		status: "awaiting_counterparty",
		round: 1,
		proposals: [proposal("p1", 96)],
	};
	const plan = planReschedule(
		event({ roster, reschedule: r }),
		input("confirm", { proposalId: "p1" }),
		NOW,
		MEMBER,
	);
	assert(plan.ok);
	assertEquals(plan.next.status, "resolved");
	assertEquals(plan.next.resolvedProposalId, "p1");

	const asHost = event({
		roster: [seat("h", "host", true), seat("c", "participant")],
		asHost: true,
		reschedule: r,
	});
	assertEquals(
		refused(planReschedule(asHost, input("confirm", { proposalId: "p1" }), NOW, MEMBER)).reason,
		"not_permitted",
	);
});
// #endregion

// #region Withdrawing, and what comes after
Deno.test("reschedule — withdrawing is recoverable: proposing again opens a new round", () => {
	const host = (r: EventReschedule) =>
		event({ roster: groupRoster("h"), asHost: true, reschedule: r });
	const collecting: EventReschedule = {
		...emptyReschedule("vote"),
		status: "collecting",
		round: 1,
		proposals: [proposal("p1", 96)],
	};

	const withdraw = planReschedule(host(collecting), input("withdraw"), NOW, MEMBER);
	assert(withdraw.ok);
	assertEquals(withdraw.next.status, "withdrawn");

	// A closed round refuses everything but a new proposal…
	assertEquals(
		refused(planReschedule(host(withdraw.next), input("open"), NOW, MEMBER)).reason,
		"vote_closed",
	);

	// …and a new proposal succeeds it with a fresh ballot, even for a slot the old round held.
	const again = planReschedule(
		host(withdraw.next),
		input("propose", { start: NOW + 96 * HOUR, end: NOW + 97 * HOUR }),
		NOW,
		MEMBER,
	);
	assert(again.ok);
	assert(again.step.kind === "propose");
	assertEquals(again.step.round, 2);
	assertEquals(again.step.newRound, true);
	assertEquals(again.next.proposals.length, 1);
	assertEquals(again.next.status, "collecting");

	// There is nothing to take back before anybody has asked.
	assertEquals(
		refused(planReschedule(host(emptyReschedule("vote")), input("withdraw"), NOW, MEMBER)).status,
		409,
	);
});
// #endregion
