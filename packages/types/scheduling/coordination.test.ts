import { assert, assertEquals, assertFalse, assertStrictEquals } from "@std/assert";
import {
	approvalRefusal,
	ballotProposals,
	canOpenCounterparty,
	canOpenVote,
	canReschedule,
	counterpartyAcceptRefusal,
	eligibleVoterCount,
	type EventAttendee,
	EventAttendeeSchema,
	eventLiveStatus,
	type EventReschedule,
	isProposalOnBallot,
	isRescheduleClosed,
	leadingProposal,
	majorityProposal,
	MIN_VOTE_PROPOSALS,
	type ProposalVote,
	RESCHEDULE_LOCKOUT_HOURS,
	RESCHEDULE_LOCKOUT_MS,
	RESCHEDULE_PROPOSALS_MAX,
	rescheduleLockoutAt,
	type RescheduleProposal,
	roundHasRoom,
	type RsvpResponse,
	rsvpTally,
	type SchedulingParty,
	settleVote,
	viewerAttendee,
	VOTE_RESOLUTION_LEAD_HOURS,
	VOTE_RESOLUTION_LEAD_MS,
	voteIsOpen,
	voteIsSettleable,
	voteOf,
	voteQuorum,
	voteResolvesAt,
	votesCast,
	voteTally,
} from "./coordination.ts";

/**
 * The scheduling coordination rules, tested where they are defined.
 *
 * These five rules govern commitments and money — whether a freelancer's calendar can still be
 * moved, whether a cohort is offered a real choice, when a decision is taken — so the cases below
 * are chosen for the boundaries, where a rule is actually decided, rather than for coverage. Every
 * assertion is written so that inverting the rule (`>=` to `>`, `<` to `<=`, two to one, "approved"
 * to "any") fails at least one of them.
 *
 * The fixed clock mirrors the scheduling fixtures' own reference instant so a figure read here reads
 * the same in a fixture.
 */

// #region Fixtures
const MINUTE = 60_000;
const HOUR = 3_600_000;
/** The scheduling fixtures' reference "now" (`packages/backend/services/scheduling/derive.ts`). */
const NOW = Date.parse("2026-07-17T16:20:00Z");
/**
 * The start of an event far enough out that its own lockout never caps a vote deadline — so the
 * tests below that are about the BALLOT measure the ballot alone. The cap has tests of its own.
 */
const FAR = NOW + 365 * 24 * HOUR;

function party(name: string): SchedulingParty {
	return { name, avatar: null, handle: name.toLowerCase() };
}

function proposal(
	over: Partial<RescheduleProposal> & { id: string; start: number },
): RescheduleProposal {
	return {
		end: over.start + HOUR,
		proposedBy: party("Ada"),
		proposedByRole: "host",
		proposedAt: NOW,
		approved: true,
		note: null,
		votes: [],
		...over,
	};
}

function vote(attendeeId: string): ProposalVote {
	return { ...party(attendeeId), attendeeId, at: NOW };
}

function attendee(id: string, response: RsvpResponse, isViewer = false): EventAttendee {
	return {
		...party(id),
		id,
		role: "participant",
		response,
		respondedAt: response === "pending" ? null : NOW,
		isViewer,
		note: null,
	};
}

function host(id: string): EventAttendee {
	return { ...attendee(id, "accepted"), role: "host" };
}

/** A live group vote over `ps`, opened by the host. */
function voting(ps: RescheduleProposal[]): EventReschedule {
	return {
		mode: "vote",
		status: "voting",
		openedBy: party("Ada"),
		openedAt: NOW - HOUR,
		proposals: ps,
		resolvesAt: voteResolvesAt(ps, FAR),
		resolvedProposalId: null,
		round: 0,
	};
}
// #endregion

// #region Rule 1 — rescheduling is disabled inside the 12-hour lockout
Deno.test("policy figures are the documented ones", () => {
	// Pinned rather than assumed: these three numbers ARE the policy, and a silent edit to any of
	// them changes what the platform promises a freelancer about their own calendar.
	assertStrictEquals(RESCHEDULE_LOCKOUT_HOURS, 12);
	assertStrictEquals(VOTE_RESOLUTION_LEAD_HOURS, 12);
	assertStrictEquals(MIN_VOTE_PROPOSALS, 2);
	assertStrictEquals(RESCHEDULE_LOCKOUT_MS, 12 * HOUR);
	assertStrictEquals(VOTE_RESOLUTION_LEAD_MS, 12 * HOUR);
});

Deno.test("canReschedule — exactly 12 hours ahead is still allowed", () => {
	// The boundary is inclusive: at exactly the lockout the notice period is satisfied.
	assert(canReschedule(NOW, NOW + 12 * HOUR));
});

Deno.test("canReschedule — one minute inside the lockout is refused", () => {
	assertFalse(canReschedule(NOW, NOW + 12 * HOUR - MINUTE));
});

Deno.test("canReschedule — one minute outside the lockout is allowed", () => {
	assert(canReschedule(NOW, NOW + 12 * HOUR + MINUTE));
});

Deno.test("canReschedule — an event already under way or finished is refused", () => {
	// Falls out of the same comparison, which is why there is no second rule for a past event.
	assertFalse(canReschedule(NOW, NOW));
	assertFalse(canReschedule(NOW, NOW - HOUR));
});

Deno.test("rescheduleLockoutAt — the countdown target is the same instant the rule uses", () => {
	const start = NOW + 40 * HOUR;
	const closesAt = rescheduleLockoutAt(start);
	assertStrictEquals(closesAt, start - 12 * HOUR);
	assert(canReschedule(closesAt, start));
	assertFalse(canReschedule(closesAt + 1, start));
});
// #endregion

// #region Rule 3 — a client-proposed slot needs the freelancer's approval
Deno.test("isProposalOnBallot — a host's own slot qualifies on arrival", () => {
	assert(isProposalOnBallot(proposal({ id: "h1", start: NOW + 48 * HOUR })));
	// Even with the flag unset: approving one's own offer would be theatre, so the role decides.
	assert(
		isProposalOnBallot(proposal({ id: "h2", start: NOW + 48 * HOUR, approved: false })),
	);
});

Deno.test("isProposalOnBallot — an unapproved attendee slot is NOT on the ballot", () => {
	assertFalse(
		isProposalOnBallot(
			proposal({
				id: "c1",
				start: NOW + 48 * HOUR,
				proposedByRole: "attendee",
				proposedBy: party("Client"),
				approved: false,
			}),
		),
	);
});

Deno.test("isProposalOnBallot — an approved attendee slot joins the ballot", () => {
	assert(
		isProposalOnBallot(
			proposal({
				id: "c2",
				start: NOW + 48 * HOUR,
				proposedByRole: "attendee",
				proposedBy: party("Client"),
				approved: true,
			}),
		),
	);
});

Deno.test("ballotProposals — filters to the choosable subset, preserving order", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR }),
		proposal({
			id: "c1",
			start: NOW + 50 * HOUR,
			proposedByRole: "attendee",
			approved: false,
		}),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assertEquals(ballotProposals(ps).map((p) => p.id), ["h1", "h2"]);
});
// #endregion

// #region Rule 2 — a vote needs at least two alternatives
Deno.test("canOpenVote — one slot is not a vote", () => {
	assertFalse(canOpenVote([]));
	assertFalse(canOpenVote([proposal({ id: "h1", start: NOW + 48 * HOUR })]));
});

Deno.test("canOpenVote — exactly two slots opens it", () => {
	assert(
		canOpenVote([
			proposal({ id: "h1", start: NOW + 48 * HOUR }),
			proposal({ id: "h2", start: NOW + 72 * HOUR }),
		]),
	);
});

Deno.test("canOpenVote — three slots open it too", () => {
	assert(
		canOpenVote([
			proposal({ id: "h1", start: NOW + 48 * HOUR }),
			proposal({ id: "h2", start: NOW + 72 * HOUR }),
			proposal({ id: "h3", start: NOW + 96 * HOUR }),
		]),
	);
});

Deno.test("canOpenVote — an unapproved client slot cannot make up the number", () => {
	// Rules 2 and 3 compose: the freelancer must supply the alternatives, so a client's pending
	// request is visible but does not count toward the minimum.
	const pending = proposal({
		id: "c1",
		start: NOW + 72 * HOUR,
		proposedByRole: "attendee",
		proposedBy: party("Client"),
		approved: false,
	});
	const host = proposal({ id: "h1", start: NOW + 48 * HOUR });
	assertFalse(canOpenVote([host, pending]));
	assert(canOpenVote([host, { ...pending, approved: true }]));
});
// #endregion

// #region Rule 4 — a vote resolves 12 hours before the earliest proposed slot
Deno.test("voteResolvesAt — 12 hours before the EARLIEST slot, not the first listed", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 96 * HOUR }),
		proposal({ id: "h2", start: NOW + 48 * HOUR }),
		proposal({ id: "h3", start: NOW + 72 * HOUR }),
	];
	assertStrictEquals(voteResolvesAt(ps, FAR), NOW + 48 * HOUR - 12 * HOUR);
});

Deno.test("voteResolvesAt — an off-ballot slot never sets the deadline", () => {
	// A client could otherwise shorten the whole cohort's decision window by proposing a near time.
	const ps = [
		proposal({ id: "h1", start: NOW + 96 * HOUR }),
		proposal({
			id: "c1",
			start: NOW + 20 * HOUR,
			proposedByRole: "attendee",
			approved: false,
		}),
	];
	assertStrictEquals(voteResolvesAt(ps, FAR), NOW + 96 * HOUR - 12 * HOUR);
});

Deno.test("voteResolvesAt — an empty ballot has no deadline", () => {
	assertStrictEquals(voteResolvesAt([], FAR), null);
	assertStrictEquals(
		voteResolvesAt([
			proposal({ id: "c1", start: NOW + 48 * HOUR, proposedByRole: "attendee", approved: false }),
		], FAR),
		null,
	);
});

Deno.test("voteIsOpen — open a minute before the deadline, closed on the stroke of it", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	const at = voteResolvesAt(ps, FAR)!;
	assert(voteIsOpen(at - MINUTE, ps, FAR));
	// Exclusive at the deadline: the vote resolves AT that instant, so a ballot cast on it is late.
	assertFalse(voteIsOpen(at, ps, FAR));
	assertFalse(voteIsOpen(at + MINUTE, ps, FAR));
});

Deno.test("voteIsOpen — a ballot whose earliest slot is already inside the window is closed", () => {
	// Proposing a time 6 hours out produces a deadline 6 hours in the PAST. That is a real, drawable
	// state, not an error: the ballot exists and can no longer elect anything.
	const ps = [
		proposal({ id: "h1", start: NOW + 6 * HOUR }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assert(voteResolvesAt(ps, FAR)! < NOW);
	assertFalse(voteIsOpen(NOW, ps, FAR));
});

Deno.test("voteIsOpen — an empty ballot is never open", () => {
	assertFalse(voteIsOpen(NOW, [], FAR));
});
// #endregion

// #region Rule 5 — live status
Deno.test("eventLiveStatus — before the start it is upcoming, with the hours remaining", () => {
	const start = NOW + 90 * MINUTE;
	const s = eventLiveStatus(NOW, start, start + HOUR);
	assertStrictEquals(s.state, "upcoming");
	assertStrictEquals(s.msUntilStart, 90 * MINUTE);
	assertStrictEquals(s.hoursUntilStart, 1.5);
});

Deno.test("eventLiveStatus — exactly at the start it is running, not upcoming", () => {
	const s = eventLiveStatus(NOW, NOW, NOW + HOUR);
	assertStrictEquals(s.state, "running");
	assertStrictEquals(s.msUntilStart, 0);
	assertStrictEquals(s.hoursUntilStart, 0);
	assertStrictEquals(s.msUntilEnd, HOUR);
});

Deno.test("eventLiveStatus — one minute in is running", () => {
	assertStrictEquals(eventLiveStatus(NOW + MINUTE, NOW, NOW + HOUR).state, "running");
});

Deno.test("eventLiveStatus — exactly at the end it has passed, not running", () => {
	const s = eventLiveStatus(NOW + HOUR, NOW, NOW + HOUR);
	assertStrictEquals(s.state, "passed");
	assertStrictEquals(s.msUntilEnd, 0);
});

Deno.test("eventLiveStatus — after the end it has passed, and nothing counts down", () => {
	const s = eventLiveStatus(NOW + 3 * HOUR, NOW, NOW + HOUR);
	assertStrictEquals(s.state, "passed");
	assertStrictEquals(s.msUntilStart, 0);
	assertStrictEquals(s.msUntilEnd, 0);
});

Deno.test("eventLiveStatus — an all-day span runs for its whole day", () => {
	const start = Date.parse("2026-07-17T00:00:00Z");
	const end = start + 24 * HOUR;
	assertStrictEquals(eventLiveStatus(start + 13 * HOUR, start, end).state, "running");
	assertStrictEquals(eventLiveStatus(end, start, end).state, "passed");
});
// #endregion

// #region Derived views
Deno.test("voteTally — highest first, ties broken by the earlier slot then the id", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 96 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({ id: "h2", start: NOW + 48 * HOUR, votes: [vote("c"), vote("d")] }),
		proposal({ id: "h3", start: NOW + 72 * HOUR, votes: [vote("e")] }),
	];
	assertEquals(voteTally(ps), [
		{ proposalId: "h2", votes: 2 },
		{ proposalId: "h1", votes: 2 },
		{ proposalId: "h3", votes: 1 },
	]);
	assertStrictEquals(leadingProposal(ps)?.id, "h2");
});

Deno.test("voteTally — an off-ballot slot is not counted, even with votes on it", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a")] }),
		proposal({
			id: "c1",
			start: NOW + 72 * HOUR,
			proposedByRole: "attendee",
			approved: false,
			votes: [vote("b"), vote("c")],
		}),
	];
	assertEquals(voteTally(ps), [{ proposalId: "h1", votes: 1 }]);
	assertStrictEquals(leadingProposal(ps)?.id, "h1");
});

Deno.test("leadingProposal — an empty ballot leads to nothing", () => {
	assertStrictEquals(leadingProposal([]), null);
});

Deno.test("voteOf — finds the slot an attendee backed, or null", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("ada")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR, votes: [vote("grace")] }),
	];
	assertStrictEquals(voteOf(ps, "grace")?.id, "h2");
	assertStrictEquals(voteOf(ps, "alan"), null);
});

Deno.test("rsvpTally — every response key is present, so a zero renders as a zero", () => {
	assertEquals(rsvpTally([]), { accepted: 0, rejected: 0, tentative: 0, pending: 0 });
	assertEquals(
		rsvpTally([
			attendee("ada", "accepted"),
			attendee("grace", "accepted"),
			attendee("alan", "tentative"),
			attendee("edsger", "pending"),
		]),
		{ accepted: 2, rejected: 0, tentative: 1, pending: 1 },
	);
});

Deno.test("viewerAttendee — resolves the viewer's own row, or null when they are not invited", () => {
	const roster = [attendee("ada", "accepted"), attendee("grace", "pending", true)];
	assertStrictEquals(viewerAttendee(roster)?.id, "grace");
	assertStrictEquals(viewerAttendee([attendee("ada", "accepted")]), null);
});

// #endregion

// #region Rule 6 — a change of time needs a MAJORITY (PRODUCT_SPEC §The Proactive Calendar)
Deno.test("eligibleVoterCount — everyone but the host, optional seats included", () => {
	// The host authored the options, so they are neither a voter nor part of the denominator; an
	// optional attendee was still invited, and a time they cannot make still excludes them.
	const roster = [
		host("ada"),
		attendee("grace", "accepted"),
		{ ...attendee("alan", "pending"), role: "optional" as const },
		attendee("edsger", "rejected"),
	];
	assertStrictEquals(eligibleVoterCount(roster), 3);
	assertStrictEquals(eligibleVoterCount([host("ada")]), 0);
	assertStrictEquals(eligibleVoterCount([]), 0);
});

Deno.test("voteQuorum — strictly more than half, so a tie never carries", () => {
	// Even electorates are the case a "half or more" reading gets wrong: 2 of 4 is a tie, not a win.
	assertStrictEquals(voteQuorum(4), 3);
	assertStrictEquals(voteQuorum(8), 5);
	// Odd ones round up rather than down.
	assertStrictEquals(voteQuorum(3), 2);
	assertStrictEquals(voteQuorum(7), 4);
	assertStrictEquals(voteQuorum(1), 1);
	// Nobody entitled to vote cannot produce a majority: 0 votes never reaches 1.
	assertStrictEquals(voteQuorum(0), 1);
});

Deno.test("majorityProposal — a plurality is NOT a majority", () => {
	// The defect this rule replaces: first-past-the-post let one vote of eight "lead" and win.
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assertStrictEquals(leadingProposal(ps)?.id, "h1", "h1 leads the tally");
	assertStrictEquals(majorityProposal(ps, 8), null, "but 1 of 8 has not carried");
	assertStrictEquals(majorityProposal(ps, 1), ps[0], "1 of 1 has");
});

Deno.test("majorityProposal — the boundary is the quorum, not the leader", () => {
	const two = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	// 2 of 4 is exactly half — a tie with the abstainers, so nothing has been agreed.
	assertStrictEquals(majorityProposal(two, 4), null);
	// 2 of 3 clears it.
	assertStrictEquals(majorityProposal(two, 3)?.id, "h1");
});

Deno.test("majorityProposal — an off-ballot slot cannot carry however many back it", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a")] }),
		proposal({
			id: "c1",
			start: NOW + 72 * HOUR,
			proposedByRole: "attendee",
			approved: false,
			votes: [vote("b"), vote("c"), vote("d")],
		}),
	];
	assertStrictEquals(majorityProposal(ps, 4), null);
});

Deno.test("majorityProposal — an empty ballot carries nothing", () => {
	assertStrictEquals(majorityProposal([], 4), null);
});

Deno.test("votesCast — counts ballots on the ballot, not off it", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({
			id: "c1",
			start: NOW + 72 * HOUR,
			proposedByRole: "attendee",
			approved: false,
			votes: [vote("c")],
		}),
	];
	assertStrictEquals(votesCast(ps), 2);
	assertStrictEquals(votesCast([]), 0);
});
// #endregion

// #region Settlement — the transition nobody performs
Deno.test("voteIsSettleable — open until the deadline, unless everybody has already answered", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assertFalse(
		voteIsSettleable(NOW, ps, 4, FAR),
		"two of four have answered and the deadline is days away",
	);
	assert(
		voteIsSettleable(NOW, ps, 2, FAR),
		"both eligible voters have answered — nothing can change",
	);
	assert(voteIsSettleable(voteResolvesAt(ps, FAR)!, ps, 4, FAR), "the deadline itself closes it");
});

Deno.test("voteIsSettleable — an electorate of nobody settles only on the deadline", () => {
	// Guard against `0 >= 0` closing a vote the instant it opens.
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assertFalse(voteIsSettleable(NOW, ps, 0, FAR));
	assert(voteIsSettleable(voteResolvesAt(ps, FAR)!, ps, 0, FAR));
});

Deno.test("settleVote — a vote that carries resolves and names its winner", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b"), vote("c")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR, votes: [vote("d")] }),
	];
	const settled = settleVote(voteResolvesAt(ps, FAR)!, voting(ps), 4, FAR);
	assertStrictEquals(settled.status, "resolved");
	assertStrictEquals(settled.resolvedProposalId, "h1");
});

Deno.test("settleVote — a vote that closes without a majority LAPSES, it does not resolve", () => {
	// `resolved` with a null winner would be indistinguishable from "not decided yet", which is how a
	// surface comes to render "moved to —". The two endings are different facts.
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR, votes: [vote("c"), vote("d")] }),
	];
	const settled = settleVote(voteResolvesAt(ps, FAR)!, voting(ps), 5, FAR);
	assertStrictEquals(settled.status, "lapsed");
	assertStrictEquals(settled.resolvedProposalId, null);
});

Deno.test("settleVote — the last eligible ballot settles it before the deadline", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR, votes: [vote("c")] }),
	];
	assert(voteIsOpen(NOW, ps, FAR), "the deadline has not arrived");
	assertStrictEquals(settleVote(NOW, voting(ps), 3, FAR).status, "resolved");
});

Deno.test("settleVote — a live vote still worth asking is returned untouched", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	const open = voting(ps);
	assertStrictEquals(settleVote(NOW, open, 6, FAR), open);
});

Deno.test("settleVote — total and idempotent, so both paths may apply it", () => {
	// The read path settles on every read and the write path settles before every action; neither can
	// know whether the other already had, so applying it twice must be indistinguishable from once.
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b"), vote("c")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	const at = voteResolvesAt(ps, FAR)!;
	const once = settleVote(at, voting(ps), 3, FAR);
	assertEquals(settleVote(at, once, 3, FAR), once);

	// Not a vote, or not open: returned unchanged rather than mangled.
	const counterparty: EventReschedule = {
		...voting(ps),
		mode: "counterparty",
		status: "awaiting_counterparty",
	};
	assertStrictEquals(settleVote(at, counterparty, 3, FAR), counterparty);
	const collecting: EventReschedule = { ...voting(ps), status: "collecting" };
	assertStrictEquals(settleVote(at, collecting, 3, FAR), collecting);
});

Deno.test("isRescheduleClosed — the three endings close a round, the four live states do not", () => {
	assert(isRescheduleClosed("resolved"));
	assert(isRescheduleClosed("lapsed"));
	assert(isRescheduleClosed("withdrawn"));
	assertFalse(isRescheduleClosed("none"));
	assertFalse(isRescheduleClosed("collecting"));
	assertFalse(isRescheduleClosed("awaiting_counterparty"));
	assertFalse(isRescheduleClosed("voting"));
});

Deno.test("roundHasRoom — a live round holds twelve slots and not thirteen; a closed one always has room", () => {
	const slots = (n: number) =>
		Array.from(
			{ length: n },
			(_, i) => proposal({ id: `p${i}`, start: NOW + (48 + i * 24) * HOUR }),
		);

	assert(roundHasRoom(voting(slots(RESCHEDULE_PROPOSALS_MAX - 1))));
	assertFalse(roundHasRoom(voting(slots(RESCHEDULE_PROPOSALS_MAX))));
	// The next slot on a closed round opens round n + 1 with an empty ballot, whatever the old one held.
	assert(roundHasRoom({ ...voting(slots(RESCHEDULE_PROPOSALS_MAX)), status: "withdrawn" }));
	assert(roundHasRoom({ ...voting(slots(RESCHEDULE_PROPOSALS_MAX)), status: "lapsed" }));
});

Deno.test("roundHasRoom — read on the SETTLED round, a full vote past its deadline has room again", () => {
	// The stored status still says `voting` once the deadline passes; only settling it says the round
	// has closed. Judged on the stale status, the Event Modal refused as `ballot_full` a slot the
	// server — which settles before acting — would accept as the next round.
	const full = voting(
		Array.from(
			{ length: RESCHEDULE_PROPOSALS_MAX },
			(_, i) => proposal({ id: `p${i}`, start: NOW + (48 + i * 24) * HOUR }),
		),
	);
	const deadline = voteResolvesAt(full.proposals, FAR)!;
	assertFalse(roundHasRoom(full), "unsettled, it reads as a live, full round");
	assertFalse(
		roundHasRoom(settleVote(deadline - 1, full, 4, FAR)),
		"before the deadline it is still live",
	);
	assert(
		roundHasRoom(settleVote(deadline, full, 4, FAR)),
		"at the deadline it lapses, and has room",
	);
});
// #endregion

// #region Derived views (continued)
Deno.test("EventAttendeeSchema — isViewer defaults to false, never undefined", () => {
	// A payload that omits it must not leave the viewer's own row indistinguishable from a stranger's.
	const parsed = EventAttendeeSchema.parse({
		id: "ada",
		name: "Ada Lovelace",
		avatar: null,
		handle: "ada",
		role: "participant",
		response: "pending",
		respondedAt: null,
		note: null,
	});
	assertStrictEquals(parsed.isViewer, false);
});
// #endregion

// #region The deadline respects the event it would move
Deno.test("voteResolvesAt — capped at the event's own lockout when every slot lies after it", () => {
	const meeting = NOW + 24 * HOUR;
	const ps = [
		proposal({ id: "p1", start: NOW + 96 * HOUR }),
		proposal({ id: "p2", start: NOW + 120 * HOUR }),
	];
	// The ballot alone would keep the vote open until 12 hours before Tuesday-next-week…
	assertStrictEquals(voteResolvesAt(ps, FAR), NOW + 84 * HOUR);
	// …but the meeting being moved locks 12 hours before IT starts, which comes first.
	assertStrictEquals(voteResolvesAt(ps, meeting), rescheduleLockoutAt(meeting));
	assertStrictEquals(voteResolvesAt(ps, meeting), NOW + 12 * HOUR);
	// An empty ballot still has no deadline at all, whatever the event.
	assertStrictEquals(voteResolvesAt([], meeting), null);
});

Deno.test("settleVote — a vote never outlives the meeting it would move", () => {
	const meeting = NOW + 24 * HOUR;
	const ps = [
		proposal({ id: "p1", start: NOW + 96 * HOUR, votes: [vote("a1")] }),
		proposal({ id: "p2", start: NOW + 120 * HOUR, votes: [vote("a2")] }),
	];
	const live: EventReschedule = { ...voting(ps), resolvesAt: voteResolvesAt(ps, meeting) };
	const lockout = rescheduleLockoutAt(meeting);

	// Still being asked a millisecond before the meeting's lockout…
	assertStrictEquals(settleVote(lockout - 1, live, 4, meeting).status, "voting");
	// …closed at it, with no majority, so the original time stands.
	assertStrictEquals(settleVote(lockout, live, 4, meeting).status, "lapsed");
	// The regression: read the day AFTER the meeting took place, the round must already be over. The
	// ballot-only deadline (NOW + 84h) left it "voting" here, and the next read past that deadline
	// would have settled it and moved a session that had already happened.
	assertStrictEquals(settleVote(meeting + 24 * HOUR, live, 4, meeting).status, "lapsed");
});

Deno.test("settleVote — a majority decided at the meeting's lockout carries to a slot still ahead", () => {
	const meeting = NOW + 24 * HOUR;
	const ps = [
		proposal({ id: "p1", start: NOW + 96 * HOUR, votes: [vote("a1"), vote("a2"), vote("a3")] }),
		proposal({ id: "p2", start: NOW + 120 * HOUR }),
	];
	const settled = settleVote(rescheduleLockoutAt(meeting), voting(ps), 5, meeting);
	assertStrictEquals(settled.status, "resolved");
	assertStrictEquals(settled.resolvedProposalId, "p1");
	// Every ballot slot starts at least the lead after the deadline, so the winner was movable-to at
	// the instant it was decided.
	assert(ps[0].start - rescheduleLockoutAt(meeting) >= VOTE_RESOLUTION_LEAD_MS);
});
// #endregion

// #region Accepting and approving a slot
Deno.test("counterpartyAcceptRefusal — the party who did NOT offer the time accepts it", () => {
	const hostSlot = proposal({ id: "h1", start: NOW + 96 * HOUR });
	const theirSlot = proposal({
		id: "c1",
		start: NOW + 96 * HOUR,
		proposedByRole: "attendee",
		approved: false,
	});

	// A host's slot, put to the attendee: theirs to accept, and nobody else's.
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "awaiting_counterparty", hostSlot, false),
		null,
	);
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "awaiting_counterparty", hostSlot, true),
		"not_permitted",
	);
	// An attendee's slot is the host's to accept — directly, with no approve-then-open detour, and
	// whether or not the host has opened anything.
	assertStrictEquals(counterpartyAcceptRefusal(NOW, "collecting", theirSlot, true), null);
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "awaiting_counterparty", theirSlot, true),
		null,
	);
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "collecting", theirSlot, false),
		"not_permitted",
	);
});

Deno.test("counterpartyAcceptRefusal — a host's slot is not accepted before it is offered", () => {
	const hostSlot = proposal({ id: "h1", start: NOW + 96 * HOUR });
	assertStrictEquals(counterpartyAcceptRefusal(NOW, "collecting", hostSlot, false), "not_offered");
});

Deno.test("counterpartyAcceptRefusal — a slot that drifted inside its notice period is refused", () => {
	const at = (h: number) => proposal({ id: `h${h}`, start: NOW + h * HOUR });
	// Inclusive at the lockout, exactly as canReschedule is.
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "awaiting_counterparty", at(RESCHEDULE_LOCKOUT_HOURS), false),
		null,
	);
	assertStrictEquals(
		counterpartyAcceptRefusal(
			NOW + MINUTE,
			"awaiting_counterparty",
			at(RESCHEDULE_LOCKOUT_HOURS),
			false,
		),
		"slot_inside_lockout",
	);
	// Already in the past — the event would be moved to a time that has gone.
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "awaiting_counterparty", at(-2), false),
		"slot_inside_lockout",
	);
	// The seat is judged first: the wrong party is told it is not theirs, not that it is late.
	assertStrictEquals(
		counterpartyAcceptRefusal(NOW, "awaiting_counterparty", at(-2), true),
		"not_permitted",
	);
});

Deno.test("approvalRefusal — a stale slot is never put on the ballot", () => {
	const slot = (h: number) =>
		proposal({ id: "c", start: NOW + h * HOUR, proposedByRole: "attendee", approved: false });
	assertStrictEquals(approvalRefusal(NOW, slot(RESCHEDULE_LOCKOUT_HOURS)), null);
	assertStrictEquals(
		approvalRefusal(NOW + 1, slot(RESCHEDULE_LOCKOUT_HOURS)),
		"slot_inside_lockout",
	);
	// Approved onto a live ballot it would have become the earliest option and pulled the deadline
	// into the past, closing a vote everybody was still answering.
	const ps = [
		proposal({ id: "p1", start: NOW + 96 * HOUR }),
		proposal({ id: "p2", start: NOW + 120 * HOUR }),
		{ ...slot(4), approved: true },
	];
	assert(voteResolvesAt(ps, FAR)! < NOW, "which is exactly why the approval is refused");
});

Deno.test("canOpenCounterparty — needs a slot the HOST offered that can still be taken", () => {
	const host = (h: number) => proposal({ id: `h${h}`, start: NOW + h * HOUR });
	const theirs = proposal({
		id: "c",
		start: NOW + 96 * HOUR,
		proposedByRole: "attendee",
		approved: true,
	});
	assertFalse(canOpenCounterparty(NOW, []));
	// An attendee cannot accept their own slot, so a question made only of theirs has no answer.
	assertFalse(canOpenCounterparty(NOW, [theirs]));
	// Every host option gone stale.
	assertFalse(canOpenCounterparty(NOW, [host(3), host(-5)]));
	assert(canOpenCounterparty(NOW, [host(3), host(96)]));
	assert(canOpenCounterparty(NOW, [theirs, host(RESCHEDULE_LOCKOUT_HOURS)]));
});
// #endregion
