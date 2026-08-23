import { assert, assertEquals, assertFalse, assertStrictEquals } from "@std/assert";
import type { CalendarEvent, SchedulingSim, SchedulingViewer } from "@projective/types/scheduling";
import {
	ANONYMOUS_VIEWER,
	canReschedule,
	eligibleVoterCount,
	isProposalOnBallot,
	majorityProposal,
	rescheduleModeFor,
	voteResolvesAt,
} from "@projective/types/scheduling";
import { ScheduleBackendService } from "./ScheduleBackendService.ts";
import { HOUR, NOW } from "./derive.ts";

/**
 * The coordination fixtures and the fat service, tested for the properties that make them usable:
 * the world they describe must obey the same rules the SSOT enforces, and it must not tell a
 * stranger things that are none of their business.
 *
 * A fixture corpus that hands a surface an open vote on a session it is simultaneously told is too
 * late to move, or a roster of six beside an attendee counter reading three, is worse than no
 * fixture at all — the UI built against it will look right and be wrong.
 *
 * **Everything goes through {@link ScheduleBackendService}, never the fixtures directly.** The
 * privacy projection lives at that boundary, so a test that read a fixture would be testing a layer
 * no caller uses and would pass while the shipped payload leaked.
 *
 * **Order matters below.** The write store is per-process, so the corpus-wide assertions come first
 * and each mutating test owns a project no other test touches.
 */

// #region Corpus
const PROJECT_SLUGS = [
	"aurora-rebrand",
	"helio-app",
	"gradient-motion-kit",
	"brand-clinic-sofia",
	"mercury-landing",
	"northwind-atlas-portal",
	"northwind-ops-retainer",
	"northwind-summit-deck",
];
const HANDLES = ["ivy", "aria", "marcus", "ravi", "sofia"];
const ENTITY_IDS = [
	"sv-brand-identity-sprint",
	"sv-portfolio-review-session",
	"sv-design-systems-workshop",
];

/** A signed-in reader. */
const MEMBER: SchedulingViewer = { authenticated: true, handle: "ahmed" };

/**
 * Seat the reader as an attendee on the two surfaces that show OTHER people's calendars.
 *
 * Seating is by identity, so a signed-in reader is a party to their own project's calendar and a
 * stranger to `@ivy`'s availability page — which is the point: being signed in is not a relationship
 * to somebody else's meeting. The simulation overlay is how a developer (and this corpus) reaches
 * the party projection on a surface they are not otherwise on, and it is honoured in development
 * only. Without it the roster-bearing branches below would have nothing to assert against, and the
 * separate stranger test (`an authenticated stranger is not a party`) pins the un-simulated case.
 */
const AS_ATTENDEE: SchedulingSim = { seat: "attendee" };

/** One page's events, or an empty list — every read goes through the service, never the fixture. */
function pageEvents(read: { ok: boolean; data?: { page: { events: CalendarEvent[] } } }) {
	return read.ok && read.data ? read.data.page.events : [];
}

/**
 * Every decorated event the corpus produces, across all three surfaces, for one viewer.
 *
 * `sim` is applied only to the two surfaces the viewer does not host — a guest ignores it entirely
 * (nothing can seat an unauthenticated caller), so `corpus(ANONYMOUS_VIEWER)` still measures the
 * real withheld projection.
 */
function corpus(viewer: SchedulingViewer, sim?: SchedulingSim): CalendarEvent[] {
	const out: CalendarEvent[] = [];
	for (const projectId of PROJECT_SLUGS) {
		out.push(...pageEvents(ScheduleBackendService.projectCalendar({ projectId }, viewer)));
	}
	for (const handle of HANDLES) {
		out.push(...pageEvents(ScheduleBackendService.availability({ handle }, viewer, sim)));
	}
	for (const entityId of ENTITY_IDS) {
		out.push(...pageEvents(ScheduleBackendService.entitySchedule({ entityId }, viewer, sim)));
	}
	return out;
}

/** The identity two seats are the same person under — the same rule the fixtures dedupe on. */
function identity(party: { handle: string | null; name: string }): string {
	return party.handle ? `@${party.handle.toLowerCase()}` : `~${party.name.toLowerCase()}`;
}
// #endregion

// #region The corpus draws every branch
Deno.test("coordination — the corpus actually produces every branch a surface has to draw", () => {
	// Without this the tests below pass vacuously: agreement is trivial when nothing is generated.
	const all = corpus(MEMBER, AS_ATTENDEE);
	const rostered = all.filter((e) => e.roster);
	const votes = all.filter((e) => e.reschedule?.mode === "vote");
	const counterparty = all.filter((e) => e.reschedule?.mode === "counterparty");

	assert(rostered.length > 20, `expected a populated corpus, got ${rostered.length} rosters`);
	assert(all.some((e) => e.pricing?.model === "per_seat"), "no priced session");
	assert(all.some((e) => (e.pricing?.remainingOccurrences ?? 0) > 1), "no recurring series");
	assert(votes.length > 0, "no group vote");
	assert(counterparty.length > 0, "no 1-on-1 negotiation");
	assert(
		votes.some((e) => e.reschedule!.proposals.some((p) => !p.approved)),
		"no client proposal awaiting host approval — rule 3 would be unrenderable",
	);
	assert(
		votes.some((e) => e.reschedule!.proposals.some((p) => p.votes.length > 0)),
		"no votes cast",
	);
	assert(rostered.some((e) => (e.history?.length ?? 0) > 0), "no history");

	// All three endings of a vote, because each is a different thing for a surface to say.
	assert(votes.some((e) => e.reschedule!.status === "voting"), "no vote still open");
	assert(votes.some((e) => e.reschedule!.status === "resolved"), "no vote has carried");
	assert(
		votes.some((e) => e.reschedule!.status === "lapsed"),
		"no vote has closed without a majority — the failure ending would be undrawable",
	);
});

Deno.test("coordination — a settled vote really did carry, and a lapsed one really did not", () => {
	// The transition nobody performs: `settleVote` is applied on the read, so these states exist in
	// the corpus without anybody having acted. Each must agree with the majority rule that produced it.
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		const r = e.reschedule;
		if (!r || r.mode !== "vote") continue;
		const voters = eligibleVoterCount(e.roster ?? []);
		const winner = majorityProposal(r.proposals, voters);
		if (r.status === "resolved") {
			assert(winner, `${e.id} resolved without a majority`);
			assertStrictEquals(r.resolvedProposalId, winner!.id, `${e.id} named the wrong winner`);
		}
		if (r.status === "lapsed") {
			assertStrictEquals(winner, null, `${e.id} lapsed while a slot had a majority`);
			assertStrictEquals(r.resolvedProposalId, null, `${e.id} lapsed but names a winner`);
		}
	}
});
// #endregion

// #region Privacy — what a stranger receives
Deno.test("privacy — an authenticated STRANGER is not a party to somebody else's calendar", () => {
	// Being signed in is not a relationship to somebody else's meeting. Seating every authenticated
	// reader as an attendee handed any signed-in account the host's join URL, passcode, the named
	// roster with its RSVP answers and private notes, and the host's per-occurrence and per-series
	// earnings — on the two surfaces that exist precisely to show OTHER people's calendars to
	// visitors (`/[handle]/availability`, `/view/[entity]/schedule`).
	const stranger: SchedulingViewer = { authenticated: true, handle: "not-a-real-member" };

	const seen: CalendarEvent[] = [];
	for (const handle of HANDLES) {
		seen.push(...pageEvents(ScheduleBackendService.availability({ handle }, stranger)));
	}
	for (const entityId of ENTITY_IDS) {
		seen.push(...pageEvents(ScheduleBackendService.entitySchedule({ entityId }, stranger)));
	}
	assert(seen.length > 20, `expected a populated public corpus, got ${seen.length}`);
	assert(seen.some((e) => !e.masked), "no unmasked event — the leaking case would be untested");

	for (const e of seen) {
		const where = `${e.id} (stranger)`;
		assertStrictEquals(e.roster, undefined, `${where} carries a roster`);
		assertStrictEquals(e.meeting, undefined, `${where} carries a room`);
		assertStrictEquals(e.pricing, undefined, `${where} carries the host's money`);
		assertStrictEquals(e.reschedule, undefined, `${where} carries a negotiation`);
		assertStrictEquals(e.history, undefined, `${where} carries an audit log`);
		assertStrictEquals(e.viewerIsHost, undefined, `${where} says who is hosting`);
	}

	// And nothing sensitive survives serialisation either — a field-by-field walk would miss anything
	// nested that the projection forgot to strip.
	const body = JSON.stringify(seen);
	for (
		const secret of ["joinUrl", "passcode", "occurrenceEarnings", "seriesEarnings", "isViewer"]
	) {
		assertStrictEquals(body.includes(secret), false, `stranger payload contains ${secret}`);
	}
});

Deno.test("privacy — the dev simulation overlay is refused outside development", () => {
	// `sim` arrives on the query string of a read and in the body of a write, so it is entirely
	// caller-controlled — and `sim.seat: "host"` names the seat that decides whether the projection
	// hands over the join URL, the roster, the money and the negotiation. That is a description of an
	// authorisation, so it may only be honoured where the SERVER says this is a development
	// environment. Without this gate it is a privilege-forgery primitive that ships to production.
	const stranger: SchedulingViewer = { authenticated: true, handle: "not-a-real-member" };
	const forge: SchedulingSim = { seat: "host" };
	const read = () =>
		pageEvents(ScheduleBackendService.availability({ handle: "ivy" }, stranger, forge));

	const before = Deno.env.get("DENO_ENV");
	try {
		Deno.env.set("DENO_ENV", "production");
		const forged = read();
		assert(forged.length > 0, "expected a populated page");
		for (const e of forged) {
			assertStrictEquals(e.roster, undefined, `${e.id} handed a forged host a roster`);
			assertStrictEquals(e.meeting, undefined, `${e.id} handed a forged host the room`);
			assertStrictEquals(e.pricing, undefined, `${e.id} handed a forged host the money`);
			assertStrictEquals(e.viewerIsHost, undefined, `${e.id} accepted a forged host seat`);
		}

		// And the same request in development still reaches the party projection — otherwise this test
		// would pass just as well against a gate that broke the overlay entirely.
		Deno.env.set("DENO_ENV", "development");
		assert(read().some((e) => e.roster), "the overlay is inert even in development");
	} finally {
		if (before === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", before);
	}
});

Deno.test("privacy — an anonymous caller receives no roster, room, money, vote or log", () => {
	// The defect: the projection was gated on `masked`, and the weekly public group session is
	// deliberately UNMASKED, so a signed-out visitor to `/[handle]/availability` was served the named
	// roster with its personal notes, the join URL, the passcode, the dial-in details and the host's
	// occurrence and series earnings.
	const anon = corpus(ANONYMOUS_VIEWER);
	assert(anon.length > 100, `expected a populated public corpus, got ${anon.length}`);

	const unmasked = anon.filter((e) => !e.masked);
	const masked = anon.filter((e) => e.masked);
	assert(unmasked.length > 0, "no unmasked event — the leaking case would be untested");
	assert(masked.length > 0, "no masked event");

	for (const e of anon) {
		const where = `${e.masked ? "masked" : "unmasked"} ${e.id}`;
		assertStrictEquals(e.roster, undefined, `${where} carries a roster`);
		assertStrictEquals(e.organiser, undefined, `${where} names its organiser`);
		assertStrictEquals(e.viewerIsHost, undefined, `${where} says who is hosting`);
		assertStrictEquals(e.meeting, undefined, `${where} carries a room`);
		assertStrictEquals(e.pricing, undefined, `${where} carries the host's earnings`);
		assertStrictEquals(e.reschedule, undefined, `${where} carries a negotiation`);
		assertStrictEquals(e.history, undefined, `${where} carries an audit log`);
		assertStrictEquals(e.meetingUrl, undefined, `${where} carries a meeting URL`);
	}
});

Deno.test("privacy — no private VALUE survives, checked against the serialised public payload", () => {
	// Field-by-field checks pass while the same secret escapes through some other key, so this looks
	// at what actually goes over the wire from every one of the three reads.
	const body = JSON.stringify(corpus(ANONYMOUS_VIEWER));
	for (
		const secret of [
			"joinUrl",
			"passcode",
			"call.example.com",
			"Dial-in",
			"occurrenceEarnings",
			"seriesEarnings",
			"Joining ten minutes late",
			"respondedAt",
			"isViewer",
			"proposedBy",
		]
	) {
		assertFalse(body.includes(secret), `the public payload still contains ${secret}`);
	}
});

Deno.test("privacy — the public facts survive, so a public schedule still renders", () => {
	// §Part 1.4's exception is a COUNT: a public group session may say how many are coming precisely
	// because it names nobody. Withholding must not take the page down with the secrets.
	const anon = corpus(ANONYMOUS_VIEWER);
	const sessions = anon.filter((e) => e.kind === "session" && !e.masked);
	assert(sessions.length > 0, "no public session survived");
	assert(
		sessions.some((e) => typeof e.attendees === "number"),
		"the attendee counter was withheld along with the roster",
	);
	for (const e of sessions) {
		assert(e.title.length > 0, `${e.id} lost its title`);
		assert(e.start > 0 && e.end > e.start, `${e.id} lost its position on the grid`);
	}
	// A masked block still says only what it always said.
	for (const e of anon.filter((e) => e.masked)) {
		assert(e.status !== undefined, `masked ${e.id} lost its privacy-safe status label`);
	}
});

Deno.test("privacy — a signed-in party still receives everything", () => {
	// The withholding must be a projection, not a deletion: the same corpus read as a party carries
	// the rooms and rosters the guest read does not.
	const mine = corpus(MEMBER, AS_ATTENDEE).filter((e) => e.roster);
	assert(mine.length > 20, "the party projection lost its rosters");
	assert(mine.some((e) => e.meeting?.joinUrl), "no join URL reaches a party");
	assert(mine.some((e) => e.pricing?.occurrenceEarnings), "no earnings reach the host");
});

Deno.test("privacy — an anonymous caller cannot write, on either write path", () => {
	// Fail-closed: the routes already require a session, but the service must refuse on its own so a
	// forgotten guard cannot become an open write.
	const page = ScheduleBackendService.availability({ handle: "ivy" }, MEMBER, AS_ATTENDEE);
	const event = pageEvents(page).find((e) => e.roster && e.end > NOW)!;
	assert(event, "no rostered upcoming event to write against");
	const target = {
		scope: "availability" as const,
		handle: "ivy",
		eventId: event.id,
		sim: AS_ATTENDEE,
	};

	const rsvp = ScheduleBackendService.respond({ ...target, response: "accepted" });
	assertStrictEquals(rsvp.ok, false);
	assertStrictEquals(rsvp.status, 403);

	const move = ScheduleBackendService.reschedule({ ...target, action: "withdraw" });
	assertStrictEquals(move.ok, false);
	assertStrictEquals(move.errors?.reason, "not_permitted");
});
// #endregion

// #region The roster is a list of distinct people
Deno.test("coordination — nobody is seated twice, and the host is seated once", () => {
	// The domain casts INCLUDE the owner and the fallback pool overlaps them, so an unfiltered draw
	// seated the host twice — and `rescheduleModeFor(2)` then routed a "meeting" of one person with
	// himself down the counterparty branch, where the counterparty was the host.
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		if (!e.roster) continue;
		const ids = e.roster.map(identity);
		assertStrictEquals(
			new Set(ids).size,
			ids.length,
			`${e.id} seats somebody twice: ${ids.join(",")}`,
		);
		assertStrictEquals(
			e.roster.filter((a) => a.role === "host").length,
			1,
			`${e.id} does not have exactly one host`,
		);
		assertStrictEquals(e.roster[0].role, "host", `first seat is not the host on ${e.id}`);
		assert(e.roster.length >= 2, `${e.id} is a meeting of one`);
	}
});

Deno.test("coordination — one handle is one person, across the whole corpus", () => {
	// A handle IS an identity: `profileHref` sends every spelling of it to the same profile page, so
	// two display names under one handle send two different people to one profile.
	const names = new Map<string, string>();
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		for (const a of e.roster ?? []) {
			if (!a.handle) continue;
			const seen = names.get(a.handle);
			if (seen === undefined) names.set(a.handle, a.name);
			else {
				assertStrictEquals(
					a.name,
					seen,
					`@${a.handle} is both "${seen}" and "${a.name}"`,
				);
			}
		}
	}
	assert(names.size > 3, "too few handles to have tested anything");
});

Deno.test("coordination — the attendee counter is restated, never invented", () => {
	// `EventBlock` renders a people-badge for ANY unmasked event carrying `attendees`, so minting one
	// for a stage sync that never had a count would put that badge on every project calendar as a
	// side effect of adding rosters.
	const all = corpus(MEMBER, AS_ATTENDEE);
	for (const e of all) {
		if (!e.roster) continue;
		if (typeof e.attendees === "number") {
			assertStrictEquals(e.attendees, e.roster.length, `counter disagrees on ${e.id}`);
			if (typeof e.capacity === "number") {
				assert(e.attendees <= e.capacity, `${e.id} seats more people than it has seats`);
			}
		}
		assertStrictEquals(
			e.roster.filter((a) => a.isViewer).length,
			1,
			`expected exactly one viewer seat on ${e.id}`,
		);
	}
	assertStrictEquals(
		all.filter((e) => e.kind === "sync" && typeof e.attendees === "number").length,
		0,
		"a stage sync gained an attendee counter it never had",
	);
	assert(
		all.some((e) => e.kind === "session" && typeof e.attendees === "number"),
		"the public session counter disappeared",
	);
});

Deno.test("coordination — a masked block is never given people, a room or a price", () => {
	// The whole point of masking is that only the status label leaks (§Part 1.4).
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		if (!e.masked) continue;
		assertStrictEquals(e.roster, undefined, `masked ${e.id} carries a roster`);
		assertStrictEquals(e.meeting, undefined, `masked ${e.id} carries a room`);
		assertStrictEquals(e.pricing, undefined, `masked ${e.id} carries a price`);
	}
});
// #endregion

// #region The audit log records the past
Deno.test("coordination — no history line, and no RSVP, is dated in the future", () => {
	// An append-only log that records the future is not an audit trail. Timestamps used to derive from
	// the EVENT's start, so anything more than a fortnight out was "created" after the clock.
	let lines = 0;
	let answers = 0;
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		for (const line of e.history ?? []) {
			lines++;
			const at = Date.parse(line.at);
			assert(at <= NOW, `${e.id}/${line.id} is stamped after the clock: ${line.at}`);
			assert(at <= e.start, `${e.id}/${line.id} was recorded after the event it describes`);
			// `unread` is "in the last day", which a negative delta satisfies trivially — which is how
			// two thirds of the badge came to be events that had not happened.
			if (line.unread) {
				assert(NOW - at < 24 * HOUR, `${e.id}/${line.id} is unread but older than a day`);
			}
		}
		for (const a of e.roster ?? []) {
			if (a.respondedAt === null) continue;
			answers++;
			assert(a.respondedAt <= NOW, `${e.id}/${a.id} answered in the future`);
			assert(a.respondedAt <= e.start, `${e.id}/${a.id} answered after the event started`);
		}
	}
	assert(lines > 100, `too few history lines to have tested anything (${lines})`);
	assert(answers > 100, `too few answers to have tested anything (${answers})`);
});

Deno.test("coordination — an unanswered seat has no answer time, and logs nothing", () => {
	// The schema's own invariant: `respondedAt` is null while pending. The log filters on it, so a
	// timestamp on an unanswered seat would record somebody answering when they said nothing.
	let pending = 0;
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		for (const a of e.roster ?? []) {
			if (a.response !== "pending") continue;
			pending++;
			assertStrictEquals(a.respondedAt, null, `${e.id}/${a.id} is pending with an answer time`);
			assertFalse(
				(e.history ?? []).some((l) => l.kind === "rsvp" && l.targetId === a.id),
				`${e.id}/${a.id} answered nothing but appears in the log`,
			);
		}
	}
	assert(pending > 0, "no pending RSVP in the corpus — the invariant would be untested");
});
// #endregion

// #region The corpus obeys the rules the SSOT enforces
Deno.test("coordination — a live negotiation never sits inside the reschedule lockout", () => {
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		if (!e.reschedule) continue;
		assert(
			canReschedule(NOW, e.start),
			`${e.id} offers a negotiation on an event that can no longer be moved`,
		);
	}
});

Deno.test("coordination — every proposed slot is one that could actually be taken up", () => {
	// A slot inside its own lockout could never be honoured, and on a ballot it drags the vote's
	// deadline into the past with it.
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		for (const p of e.reschedule?.proposals ?? []) {
			assert(canReschedule(NOW, p.start), `${e.id}/${p.id} proposes an unusable time`);
			assert(p.end > p.start, `${e.id}/${p.id} ends before it starts`);
			assert(p.proposedAt <= NOW, `${e.id}/${p.id} was proposed in the future`);
		}
	}
});

Deno.test("coordination — the negotiation mode agrees with the head count", () => {
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		if (!e.reschedule) continue;
		assertStrictEquals(
			e.reschedule.mode,
			rescheduleModeFor(e.roster?.length ?? 0),
			`mode disagrees with the roster on ${e.id}`,
		);
	}
});

Deno.test("coordination — a vote's stamped deadline is the one the rule derives", () => {
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		const r = e.reschedule;
		if (!r || r.mode !== "vote") continue;
		assertStrictEquals(
			r.resolvesAt,
			voteResolvesAt(r.proposals),
			`stamped deadline disagrees with the ballot on ${e.id}`,
		);
	}
});

Deno.test("coordination — nobody has voted for a slot that is not on the ballot", () => {
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		for (const p of e.reschedule?.proposals ?? []) {
			if (p.votes.length > 0) {
				assert(isProposalOnBallot(p), `${e.id}/${p.id} carries votes but is not on the ballot`);
			}
		}
		// One vote per attendee, per negotiation.
		const cast = (e.reschedule?.proposals ?? []).flatMap((p) => p.votes.map((v) => v.attendeeId));
		assertStrictEquals(new Set(cast).size, cast.length, `duplicate vote on ${e.id}`);
		// And every ballot cast belongs to somebody actually on the roster.
		const seats = new Set((e.roster ?? []).map((a) => a.id));
		for (const id of cast) assert(seats.has(id), `${e.id} carries a vote from a non-attendee`);
	}
});

Deno.test("coordination — money is server-computed and internally consistent", () => {
	for (const e of corpus(MEMBER, AS_ATTENDEE)) {
		const p = e.pricing;
		if (!p) continue;
		if (p.model === "free") {
			assertStrictEquals(p.unitPrice, null, `${e.id} prices a free event`);
			assertStrictEquals(p.occurrenceEarnings, null);
			continue;
		}
		assert(p.unitPrice, `${e.id} is priced but carries no unit price`);
		// The client never multiplies money, so the product must already be right in the payload.
		assertStrictEquals(
			p.occurrenceEarnings!.minor,
			p.unitPrice!.minor * p.paidSeats,
			`${e.id} earnings are not seats × price`,
		);
		if (p.seriesEarnings) {
			assertStrictEquals(
				p.seriesEarnings.minor,
				p.occurrenceEarnings!.minor * p.remainingOccurrences,
				`${e.id} series total is not the occurrence × the remaining count`,
			);
		}
		assert(p.unitPrice!.display.length > 0, `${e.id} has no formatted figure to render`);
	}
});

Deno.test("coordination — a read is deterministic, so SSR and the island refetch agree", () => {
	for (const projectId of PROJECT_SLUGS) {
		assertEquals(
			ScheduleBackendService.projectCalendar({ projectId }, MEMBER),
			ScheduleBackendService.projectCalendar({ projectId }, MEMBER),
			`${projectId} is not deterministic`,
		);
	}
	// And the public projection is deterministic too — a cache in front of it must be safe.
	assertEquals(
		ScheduleBackendService.availability({ handle: "ivy" }, ANONYMOUS_VIEWER),
		ScheduleBackendService.availability({ handle: "ivy" }, ANONYMOUS_VIEWER),
	);
});
// #endregion

// #region Writes — each owns a project no other test touches
Deno.test("ScheduleBackendService — the vote gate refuses one slot and admits two", () => {
	// End to end through the fat service: the two-slot minimum is applied where the write happens,
	// not merely where the predicate is defined.
	const events = pageEvents(
		ScheduleBackendService.projectCalendar({ projectId: "brand-clinic-sofia" }, MEMBER),
	);
	const event = events.find((e) =>
		e.roster && e.viewerIsHost && canReschedule(NOW, e.start) && !e.reschedule
	)!;
	assert(event, "no host-viewable, movable, un-negotiated event to test against");
	const target = { scope: "project" as const, projectId: "brand-clinic-sofia", eventId: event.id };

	const empty = ScheduleBackendService.reschedule({ ...target, action: "open" }, MEMBER);
	assertStrictEquals(empty.ok, false);
	assertStrictEquals(empty.errors?.reason, "not_enough_proposals");

	const first = ScheduleBackendService.reschedule({
		...target,
		action: "propose",
		start: event.start + 86_400_000,
		end: event.end + 86_400_000,
	}, MEMBER);
	assert(first.ok, first.message);
	assertStrictEquals(first.data!.event.reschedule!.status, "collecting");

	const one = ScheduleBackendService.reschedule({ ...target, action: "open" }, MEMBER);
	assertStrictEquals(one.ok, false);
	assertStrictEquals(one.errors?.reason, "not_enough_proposals");

	ScheduleBackendService.reschedule({
		...target,
		action: "propose",
		start: event.start + 172_800_000,
		end: event.end + 172_800_000,
	}, MEMBER);
	const two = ScheduleBackendService.reschedule({ ...target, action: "open" }, MEMBER);
	assert(two.ok, two.message);
	const open = two.data!.event.reschedule!;
	assertStrictEquals(open.status, "voting");
	assertStrictEquals(open.resolvesAt, voteResolvesAt(open.proposals));
});

Deno.test("ScheduleBackendService — a slot inside its own lockout is refused, not put on a ballot", () => {
	// The defect: only the EVENT was checked against the lockout, never the slot being offered — so a
	// host could open a vote whose deadline (12h before the earliest slot) was already in the past,
	// and the ballot could elect a time that was itself already unmovable.
	const events = pageEvents(
		ScheduleBackendService.projectCalendar({ projectId: "northwind-summit-deck" }, MEMBER),
	);
	const event = events.find((e) =>
		e.roster && e.viewerIsHost && canReschedule(NOW, e.start) && !e.reschedule
	)!;
	assert(event, "no host-viewable, movable, un-negotiated event to test against");
	const target = {
		scope: "project" as const,
		projectId: "northwind-summit-deck",
		eventId: event.id,
	};

	const soon = ScheduleBackendService.reschedule({
		...target,
		action: "propose",
		start: NOW + 2 * HOUR,
		end: NOW + 3 * HOUR,
	}, MEMBER);
	assertStrictEquals(soon.ok, false);
	assertStrictEquals(soon.errors?.reason, "proposal_inside_lockout");

	// The boundary is the same inclusive one `canReschedule` uses.
	const boundary = ScheduleBackendService.reschedule({
		...target,
		action: "propose",
		start: NOW + 12 * HOUR,
		end: NOW + 13 * HOUR,
	}, MEMBER);
	assert(boundary.ok, boundary.message);

	// But a ballot whose deadline is already gone cannot be OPENED either — the second half of the
	// same rule, so a slot exactly on the boundary cannot produce a vote nobody can answer.
	ScheduleBackendService.reschedule({
		...target,
		action: "propose",
		start: NOW + 20 * HOUR,
		end: NOW + 21 * HOUR,
	}, MEMBER);
	const opened = ScheduleBackendService.reschedule({ ...target, action: "open" }, MEMBER);
	if (opened.ok) {
		const r = opened.data!.event.reschedule!;
		assert(r.resolvesAt === null || r.resolvesAt > NOW, "opened a vote whose deadline had passed");
	} else {
		assertStrictEquals(opened.errors?.reason, "vote_closed");
	}
});

Deno.test("ScheduleBackendService — withdrawing is recoverable: proposing again opens a new round", () => {
	// The defect: `withdraw` set a status the closed-round guard then blocked `open` from ever
	// leaving, while still admitting `propose` — so a host who withdrew once accumulated slots forever
	// with no way to put any of them to anybody.
	const events = pageEvents(
		ScheduleBackendService.projectCalendar({ projectId: "mercury-landing" }, MEMBER),
	);
	const event = events.find((e) =>
		e.roster && e.viewerIsHost && canReschedule(NOW, e.start) && !e.reschedule
	)!;
	assert(event, "no host-viewable, movable, un-negotiated event to test against");
	const target = { scope: "project" as const, projectId: "mercury-landing", eventId: event.id };
	const slot = (hours: number) => ({
		action: "propose" as const,
		start: NOW + hours * HOUR,
		end: NOW + (hours + 1) * HOUR,
	});

	ScheduleBackendService.reschedule({ ...target, ...slot(48) }, MEMBER);
	ScheduleBackendService.reschedule({ ...target, ...slot(72) }, MEMBER);
	const opened = ScheduleBackendService.reschedule({ ...target, action: "open" }, MEMBER);
	assert(opened.ok, opened.message);
	const round0 = opened.data!.event.reschedule!;
	assertStrictEquals(round0.round, 0);
	const proposalCount = round0.proposals.length;

	const pulled = ScheduleBackendService.reschedule({ ...target, action: "withdraw" }, MEMBER);
	assert(pulled.ok, pulled.message);
	assertStrictEquals(pulled.data!.event.reschedule!.status, "withdrawn");

	// A withdrawn round is closed to everything except starting again.
	for (const action of ["open", "vote", "confirm", "approve", "withdraw"] as const) {
		const blocked = ScheduleBackendService.reschedule({ ...target, action }, MEMBER);
		assertStrictEquals(blocked.ok, false, `${action} was allowed on a withdrawn round`);
		assertStrictEquals(blocked.errors?.reason, "vote_closed");
	}

	// Proposing again starts round 1 with a FRESH ballot rather than appending to the dead one.
	const again = ScheduleBackendService.reschedule({ ...target, ...slot(96) }, MEMBER);
	assert(again.ok, again.message);
	const round1 = again.data!.event.reschedule!;
	assertStrictEquals(round1.round, 1);
	assertStrictEquals(round1.status, "collecting");
	assertStrictEquals(round1.proposals.length, 1);
	assert(proposalCount > 1, "the first round should have held more than one slot");
	// Ids do not collide across rounds, so an action can never address the wrong slot.
	assertFalse(round0.proposals.some((p) => p.id === round1.proposals[0].id));

	// And the new round can be put to people, which the old one no longer could.
	ScheduleBackendService.reschedule({ ...target, ...slot(120) }, MEMBER);
	const reopened = ScheduleBackendService.reschedule({ ...target, action: "open" }, MEMBER);
	assert(reopened.ok, reopened.message);
	assertStrictEquals(reopened.data!.event.reschedule!.status, "voting");
});

Deno.test("ScheduleBackendService — a host finalises a vote that carried, and only one that has", () => {
	// The defect: `confirm` was hard-gated to counterparty mode, so `resolved` was unreachable on the
	// vote path and the only exit was to withdraw. It now closes a DECIDED vote early — it never
	// decides one, because PRODUCT_SPEC §The Proactive Calendar requires a majority.
	const withMajority: { projectId: string; event: CalendarEvent }[] = [];
	const withoutMajority: { projectId: string; event: CalendarEvent }[] = [];
	for (const projectId of PROJECT_SLUGS) {
		for (const e of pageEvents(ScheduleBackendService.projectCalendar({ projectId }, MEMBER))) {
			const r = e.reschedule;
			if (!r || r.mode !== "vote" || r.status !== "voting" || !e.viewerIsHost) continue;
			const bucket = majorityProposal(r.proposals, eligibleVoterCount(e.roster ?? []))
				? withMajority
				: withoutMajority;
			bucket.push({ projectId, event: e });
		}
	}
	assert(
		withMajority.length > 0,
		"no open vote has carried — the terminal transition is untestable",
	);
	assert(withoutMajority.length > 0, "no open vote is undecided — the refusal is untestable");

	const undecided = withoutMajority[0];
	const refused = ScheduleBackendService.reschedule({
		scope: "project",
		projectId: undecided.projectId,
		eventId: undecided.event.id,
		action: "confirm",
	}, MEMBER);
	assertStrictEquals(refused.ok, false);
	assertStrictEquals(refused.errors?.reason, "no_majority");

	const decided = withMajority[0];
	const winner = majorityProposal(
		decided.event.reschedule!.proposals,
		eligibleVoterCount(decided.event.roster ?? []),
	)!;
	// Naming a slot other than the one that carried is refused rather than quietly substituted.
	const wrong = ScheduleBackendService.reschedule({
		scope: "project",
		projectId: decided.projectId,
		eventId: decided.event.id,
		action: "confirm",
		proposalId: decided.event.reschedule!.proposals.find((p) => p.id !== winner.id)?.id,
	}, MEMBER);
	assertStrictEquals(wrong.ok, false);
	assertStrictEquals(wrong.errors?.reason, "no_majority");

	const done = ScheduleBackendService.reschedule({
		scope: "project",
		projectId: decided.projectId,
		eventId: decided.event.id,
		action: "confirm",
	}, MEMBER);
	assert(done.ok, done.message);
	const settled = done.data!.event.reschedule!;
	assertStrictEquals(settled.status, "resolved");
	assertStrictEquals(settled.resolvedProposalId, winner.id);
	// The log records the transition, with no actor: a deadline resolved it, not a person.
	const line = (done.data!.event.history ?? []).find((l) => l.kind === "rescheduled");
	assert(line, "a resolved vote left no line in the audit log");
	assertStrictEquals(line!.actor, null);

	// And a resolved round is closed, like every other ending.
	const after = ScheduleBackendService.reschedule({
		scope: "project",
		projectId: decided.projectId,
		eventId: decided.event.id,
		action: "confirm",
	}, MEMBER);
	assertStrictEquals(after.ok, false);
	assertStrictEquals(after.errors?.reason, "vote_closed");
});

Deno.test("ScheduleBackendService — an RSVP round-trips, and cannot be made on a finished event", () => {
	const page = ScheduleBackendService.availability({ handle: "ivy" }, MEMBER, AS_ATTENDEE);
	const events = pageEvents(page);
	const target = { scope: "availability" as const, handle: "ivy", sim: AS_ATTENDEE };

	const upcoming = events.find((e) => e.roster && e.end > NOW)!;
	assert(upcoming, "no upcoming rostered event on the availability corpus");
	const before = upcoming.roster!.find((a) => a.isViewer)!.response;
	const next = before === "accepted" ? "tentative" : "accepted";
	const res = ScheduleBackendService.respond({
		...target,
		eventId: upcoming.id,
		response: next,
	}, MEMBER);
	assert(res.ok, res.message);
	assertStrictEquals(res.data!.event.roster!.find((a) => a.isViewer)!.response, next);

	const past = events.find((e) => e.roster && e.end <= NOW);
	if (past) {
		const late = ScheduleBackendService.respond({
			...target,
			eventId: past.id,
			response: "accepted",
		}, MEMBER);
		assertStrictEquals(late.ok, false);
		assertStrictEquals(late.errors?.reason, "event_passed");
	}
});

Deno.test("ScheduleBackendService — clearing an RSVP is truthful, not recorded as answering Maybe", () => {
	// `pending` is a real answer to give: "I have not decided" is not "Maybe". The old overlay stamped
	// `respondedAt: NOW` for it, breaking the schema's null-while-pending invariant, and the log's
	// three-way ternary then fell through to "Marked Maybe".
	const events = pageEvents(
		ScheduleBackendService.availability({ handle: "aria" }, MEMBER, AS_ATTENDEE),
	);
	const event = events.find((e) => e.roster && e.end > NOW)!;
	assert(event, "no upcoming rostered event to answer");
	const target = {
		scope: "availability" as const,
		handle: "aria",
		eventId: event.id,
		sim: AS_ATTENDEE,
	};

	const said = ScheduleBackendService.respond({ ...target, response: "accepted" }, MEMBER);
	assert(said.ok, said.message);
	const answered = said.data!.event.roster!.find((a) => a.isViewer)!;
	assertStrictEquals(answered.response, "accepted");
	assert(answered.respondedAt !== null, "an answer carries the time it was given");

	const cleared = ScheduleBackendService.respond({ ...target, response: "pending" }, MEMBER);
	assert(cleared.ok, cleared.message);
	const seat = cleared.data!.event.roster!.find((a) => a.isViewer)!;
	assertStrictEquals(seat.response, "pending");
	assertStrictEquals(seat.respondedAt, null, "a cleared answer kept its answer time");
	assertFalse(
		(cleared.data!.event.history ?? []).some((l) =>
			l.targetId === seat.id && l.summary === "Marked Maybe"
		),
		"clearing a response was logged as answering Maybe",
	);
});

Deno.test("ScheduleBackendService — an unknown event is a 404, not an empty success", () => {
	const res = ScheduleBackendService.respond({
		scope: "project",
		projectId: "brand-clinic-sofia",
		eventId: "no-such-event",
		response: "accepted",
	}, MEMBER);
	assertStrictEquals(res.ok, false);
	assertStrictEquals(res.status, 404);
});
// #endregion
