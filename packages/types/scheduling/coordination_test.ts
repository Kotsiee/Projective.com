import { assert, assertEquals, assertFalse, assertStrictEquals } from "@std/assert";
import {
	ballotProposals,
	canOpenVote,
	canReschedule,
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
	rescheduleLockoutAt,
	type RescheduleProposal,
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
		resolvesAt: voteResolvesAt(ps),
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
	assertStrictEquals(voteResolvesAt(ps), NOW + 48 * HOUR - 12 * HOUR);
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
	assertStrictEquals(voteResolvesAt(ps), NOW + 96 * HOUR - 12 * HOUR);
});

Deno.test("voteResolvesAt — an empty ballot has no deadline", () => {
	assertStrictEquals(voteResolvesAt([]), null);
	assertStrictEquals(
		voteResolvesAt([
			proposal({ id: "c1", start: NOW + 48 * HOUR, proposedByRole: "attendee", approved: false }),
		]),
		null,
	);
});

Deno.test("voteIsOpen — open a minute before the deadline, closed on the stroke of it", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	const at = voteResolvesAt(ps)!;
	assert(voteIsOpen(at - MINUTE, ps));
	// Exclusive at the deadline: the vote resolves AT that instant, so a ballot cast on it is late.
	assertFalse(voteIsOpen(at, ps));
	assertFalse(voteIsOpen(at + MINUTE, ps));
});

Deno.test("voteIsOpen — a ballot whose earliest slot is already inside the window is closed", () => {
	// Proposing a time 6 hours out produces a deadline 6 hours in the PAST. That is a real, drawable
	// state, not an error: the ballot exists and can no longer elect anything.
	const ps = [
		proposal({ id: "h1", start: NOW + 6 * HOUR }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assert(voteResolvesAt(ps)! < NOW);
	assertFalse(voteIsOpen(NOW, ps));
});

Deno.test("voteIsOpen — an empty ballot is never open", () => {
	assertFalse(voteIsOpen(NOW, []));
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
		voteIsSettleable(NOW, ps, 4),
		"two of four have answered and the deadline is days away",
	);
	assert(voteIsSettleable(NOW, ps, 2), "both eligible voters have answered — nothing can change");
	assert(voteIsSettleable(voteResolvesAt(ps)!, ps, 4), "the deadline itself closes it");
});

Deno.test("voteIsSettleable — an electorate of nobody settles only on the deadline", () => {
	// Guard against `0 >= 0` closing a vote the instant it opens.
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	assertFalse(voteIsSettleable(NOW, ps, 0));
	assert(voteIsSettleable(voteResolvesAt(ps)!, ps, 0));
});

Deno.test("settleVote — a vote that carries resolves and names its winner", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b"), vote("c")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR, votes: [vote("d")] }),
	];
	const settled = settleVote(voteResolvesAt(ps)!, voting(ps), 4);
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
	const settled = settleVote(voteResolvesAt(ps)!, voting(ps), 5);
	assertStrictEquals(settled.status, "lapsed");
	assertStrictEquals(settled.resolvedProposalId, null);
});

Deno.test("settleVote — the last eligible ballot settles it before the deadline", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR, votes: [vote("c")] }),
	];
	assert(voteIsOpen(NOW, ps), "the deadline has not arrived");
	assertStrictEquals(settleVote(NOW, voting(ps), 3).status, "resolved");
});

Deno.test("settleVote — a live vote still worth asking is returned untouched", () => {
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	const open = voting(ps);
	assertStrictEquals(settleVote(NOW, open, 6), open);
});

Deno.test("settleVote — total and idempotent, so both paths may apply it", () => {
	// The read path settles on every read and the write path settles before every action; neither can
	// know whether the other already had, so applying it twice must be indistinguishable from once.
	const ps = [
		proposal({ id: "h1", start: NOW + 48 * HOUR, votes: [vote("a"), vote("b"), vote("c")] }),
		proposal({ id: "h2", start: NOW + 72 * HOUR }),
	];
	const at = voteResolvesAt(ps)!;
	const once = settleVote(at, voting(ps), 3);
	assertEquals(settleVote(at, once, 3), once);

	// Not a vote, or not open: returned unchanged rather than mangled.
	const counterparty: EventReschedule = {
		...voting(ps),
		mode: "counterparty",
		status: "awaiting_counterparty",
	};
	assertStrictEquals(settleVote(at, counterparty, 3), counterparty);
	const collecting: EventReschedule = { ...voting(ps), status: "collecting" };
	assertStrictEquals(settleVote(at, collecting, 3), collecting);
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
