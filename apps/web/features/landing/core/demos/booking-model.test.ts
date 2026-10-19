/**
 * booking-model.test — the Booking demo (V4) against the product's own rules: the fixtures parse as
 * the real `@projective/types/scheduling` shapes, times are the viewer's with the freelancer's zone
 * named (J8), taken times stay listed and are refused (J9), booking holds the payment (J2), moves
 * inside 12 hours are refused (J11), a group reschedule is a majority of everyone but the host with
 * abstention counting against (J10, Decision #71), and the calendar line is the order's file export
 * (J12). Then the copy is §4.4's verbatim and the six frames are the reducer's own states.
 */
import { assert, assertEquals, assertFalse, assertNotStrictEquals } from "@std/assert";
import {
	canReschedule,
	EventAttendeeSchema,
	EventRescheduleSchema,
	majorityProposal,
	RESCHEDULE_LOCKOUT_MS,
	rescheduleModeFor,
	RescheduleProposalSchema,
	SchedulingPartySchema,
	settleVote,
	SlotGridSchema,
	voteQuorum,
	voteResolvesAt,
	zonedParts,
} from "@projective/types/scheduling";
import { calendarLinksFor } from "@projective/types/finance";
import {
	announcementFor,
	BOOKING_COPY,
	BOOKING_DAY_KEY,
	BOOKING_GRID,
	BOOKING_NOW_MS,
	type BookingAction,
	bookingFrames,
	type BookingState,
	createBooking,
	dayLabel,
	daySlots,
	FRAME_SLOT_ID,
	FREELANCER_ZONE,
	GROUP_ELIGIBLE,
	GROUP_OFFERS,
	GROUP_QUORUM,
	GROUP_ROSTER,
	GROUP_SCRIPT,
	GROUP_SESSION,
	groupView,
	HOST,
	PROVIDER_MIN_NOTICE_MINUTES,
	reduceBooking,
	runBooking,
	SESSION_MINUTES,
	slotSummary,
	timeLabel,
	VIEWER_ATTENDEE_ID,
	VIEWER_ZONE,
	weekdayTimeLabel,
	whenLabel,
	zoneCity,
} from "./booking-model.ts";

// #region Helpers
/** The state after a script, from the opening state. */
function after(
	actions: readonly BookingAction[],
	from: BookingState = createBooking(),
): BookingState {
	return runBooking(from, actions).at(-1)!;
}

const vote = (attendeeId: string, proposalId: string): BookingAction => ({
	type: "vote",
	attendeeId,
	proposalId,
});

/** The group round opened by the host's offer. */
const offered = (): BookingState => after([{ type: "propose_group" }]);
// #endregion

// #region Fixtures are the product's shapes
Deno.test("booking fixtures: the grid, roster, host and offers parse as the real scheduling shapes", () => {
	assertEquals(SlotGridSchema.parse(BOOKING_GRID), BOOKING_GRID);
	assertEquals(SchedulingPartySchema.parse(HOST), HOST);
	for (const attendee of GROUP_ROSTER) assertEquals(EventAttendeeSchema.parse(attendee), attendee);
	for (const offer of GROUP_OFFERS) assertEquals(RescheduleProposalSchema.parse(offer), offer);
	for (const frame of bookingFrames()) {
		assertEquals(
			EventRescheduleSchema.parse(frame.state.group.reschedule),
			frame.state.group.reschedule,
		);
	}
});

Deno.test("booking fixtures: one day in the viewer's zone, its rail counts matching its slots", () => {
	const [day] = BOOKING_GRID.days;
	assertEquals(BOOKING_GRID.days.length, 1);
	assertEquals(day.key, BOOKING_DAY_KEY);
	assertEquals(day.key, "2026-10-20");
	assertEquals(day.totalCount, daySlots().length);
	assertEquals(day.openCount, daySlots().filter((s) => s.available).length);
	for (const slot of daySlots()) {
		assertEquals(slot.endsAt - slot.startsAt, SESSION_MINUTES * 60_000);
		assert(slot.available === (slot.reason === null), "a reason only on an unavailable slot");
	}
});
// #endregion

// #region Time zones (J8)
Deno.test("zones: now is Tue 20 Oct 2026, 9:00 am in London, five hours ahead of New York", () => {
	assertEquals(dayLabel(BOOKING_NOW_MS, VIEWER_ZONE), "Tue 20 Oct");
	assertEquals(timeLabel(BOOKING_NOW_MS, VIEWER_ZONE), "9:00 am");
	assertEquals(timeLabel(BOOKING_NOW_MS, FREELANCER_ZONE), "4:00 am");
	assertEquals(new Date(BOOKING_NOW_MS).toISOString(), "2026-10-20T08:00:00.000Z");
});

Deno.test("zones: each slot is one instant, shown on the London clock with the New York clock beside it", () => {
	const london = daySlots().map((s) => timeLabel(s.startsAt, VIEWER_ZONE));
	const newYork = daySlots().map((s) => timeLabel(s.startsAt, FREELANCER_ZONE));
	assertEquals(london, ["2:00 pm", "3:00 pm", "4:00 pm", "5:00 pm"]);
	assertEquals(newYork, ["9:00 am", "10:00 am", "11:00 am", "12:00 pm"]);
	for (const slot of daySlots()) {
		const hours = zonedParts(slot.startsAt, VIEWER_ZONE).hour -
			zonedParts(slot.startsAt, FREELANCER_ZONE).hour;
		assertEquals(hours, 5);
	}
});

Deno.test("zones: the note names both cities, verbatim (§4.4)", () => {
	assertEquals(zoneCity(VIEWER_ZONE), "London");
	assertEquals(zoneCity(FREELANCER_ZONE), "New York");
	assertEquals(
		BOOKING_COPY.zoneNote(BOOKING_GRID.viewerTimezone, BOOKING_GRID.providerTimezone),
		"Times shown in your time zone (London). The freelancer is in New York.",
	);
});

Deno.test("zones: labels are built from zone parts, so midnight and noon read as the product's twelve-hour clock", () => {
	const midnight = Date.UTC(2026, 9, 19, 23, 0);
	const noon = Date.UTC(2026, 9, 20, 11, 30);
	assertEquals(timeLabel(midnight, VIEWER_ZONE), "12:00 am");
	assertEquals(timeLabel(noon, VIEWER_ZONE), "12:30 pm");
	assertEquals(whenLabel(GROUP_OFFERS[0].start, VIEWER_ZONE), "Thu 22 Oct · 3:00 pm");
	assertEquals(weekdayTimeLabel(GROUP_OFFERS[0].start, VIEWER_ZONE), "Thu 3:00 pm");
});
// #endregion

// #region Picking and booking (J9, J2)
Deno.test("slots: taken times stay on the list, and picking one is refused with the state unchanged", () => {
	const taken = daySlots().filter((s) => !s.available);
	assertEquals(taken.length, 2);
	const open = createBooking();
	for (const slot of taken) {
		const result = reduceBooking(open, { type: "pick", slotId: slot.id });
		assertEquals(result.outcome, { kind: "refused", reason: "taken" });
		assertEquals(result.state, open);
		assertEquals(announcementFor(result), null, "the slot's own name says why");
	}
});

Deno.test("slots: the reason is named only in the accessible name, as SlotPicker names it", () => {
	const names = daySlots().map((s) => slotSummary(s, VIEWER_ZONE));
	assertEquals(names, [
		"2:00 pm, already booked",
		"3:00 pm, 60 minutes",
		"4:00 pm, already booked",
		"5:00 pm, 60 minutes",
	]);
});

Deno.test("slots: a pick toggles, and a second pick replaces the first (single-select)", () => {
	const picked = reduceBooking(createBooking(), { type: "pick", slotId: "slot-1500" });
	assertEquals(picked.outcome, { kind: "picked", slotId: "slot-1500" });
	assertEquals(picked.state.selectedId, "slot-1500");
	const replaced = reduceBooking(picked.state, { type: "pick", slotId: "slot-1700" });
	assertEquals(replaced.state.selectedId, "slot-1700");
	const cleared = reduceBooking(replaced.state, { type: "pick", slotId: "slot-1700" });
	assertEquals(cleared.outcome, { kind: "unpicked", slotId: "slot-1700" });
	assertEquals(cleared.state.selectedId, null);
});

Deno.test("booking: needs a pick, holds the payment, and then fixes the pick", () => {
	assertEquals(reduceBooking(createBooking(), { type: "book" }).outcome, {
		kind: "refused",
		reason: "nothing_picked",
	});
	const booked = reduceBooking(after([{ type: "pick", slotId: "slot-1500" }]), { type: "book" });
	assertEquals(booked.outcome, { kind: "booked", slotId: "slot-1500" });
	assertEquals(booked.state.bookedId, "slot-1500");
	assertEquals(announcementFor(booked), "The session is booked, and your payment is held.");
	assertEquals(
		BOOKING_COPY.book(timeLabel(daySlots()[1].startsAt, VIEWER_ZONE)),
		"Book 3:00 pm",
	);
	assertEquals(reduceBooking(booked.state, { type: "pick", slotId: "slot-1700" }).outcome, {
		kind: "refused",
		reason: "already_booked",
	});
	assertEquals(reduceBooking(booked.state, { type: "book" }).outcome, {
		kind: "refused",
		reason: "already_booked",
	});
});
// #endregion

// #region Minimum notice — the provider's own setting
Deno.test("notice: this provider's 2 hours open the afternoon; the product's 12-hour default would not", () => {
	const DEFAULT_NOTICE_MINUTES = 720; // `DEFAULT_GRID_RULES.minNoticeMinutes`, `call_settings` default
	assert(PROVIDER_MIN_NOTICE_MINUTES >= 0, "call_settings.min_notice_minutes CHECK (>= 0)");
	assertEquals(BOOKING_GRID.bookableFrom, BOOKING_NOW_MS + PROVIDER_MIN_NOTICE_MINUTES * 60_000);
	const open = daySlots().filter((s) => s.available);
	assert(open.length > 0);
	for (const slot of open) {
		assert(slot.startsAt >= BOOKING_GRID.bookableFrom!, "every open time clears the notice");
		assert(
			slot.startsAt < BOOKING_NOW_MS + DEFAULT_NOTICE_MINUTES * 60_000,
			"on a default schedule this time would be inside the minimum notice",
		);
	}
	assert(
		PROVIDER_MIN_NOTICE_MINUTES * 60_000 < RESCHEDULE_LOCKOUT_MS,
		"a notice shorter than the lockout is what lets a just-booked session be locked",
	);
});
// #endregion

// #region The 12-hour lockout (J11)
Deno.test("lockout: every bookable time starts under 12 hours away, so moving it is refused", () => {
	for (const slot of daySlots().filter((s) => s.available)) {
		assert(slot.startsAt - BOOKING_NOW_MS < RESCHEDULE_LOCKOUT_MS);
		assertFalse(canReschedule(BOOKING_NOW_MS, slot.startsAt));
		const booked = after([{ type: "pick", slotId: slot.id }, { type: "book" }]);
		const result = reduceBooking(booked, { type: "propose_one_to_one" });
		assertEquals(result.outcome, { kind: "refused", reason: "inside_lockout" });
		assertEquals(result.state.oneToOneRefusal, "inside_lockout");
		assertEquals(announcementFor(result), "Too late to move this. It starts in under 12 hours.");
	}
});

Deno.test("lockout: a one-to-one is two people (the other party confirms), and there is nothing to move before booking", () => {
	assertEquals(rescheduleModeFor(2), "counterparty");
	assertEquals(reduceBooking(createBooking(), { type: "propose_one_to_one" }).outcome, {
		kind: "refused",
		reason: "not_booked",
	});
});
// #endregion

// #region The group vote (J10, Decision #71)
Deno.test("group: the host plus three attendees settle by vote; the host never votes; two of three carry", () => {
	assertEquals(GROUP_ROSTER.length, 4);
	assertEquals(rescheduleModeFor(GROUP_ROSTER.length), "vote");
	assertEquals(GROUP_ROSTER.filter((a) => a.role === "host").length, 1);
	assertEquals(GROUP_ELIGIBLE, 3);
	assertEquals(GROUP_QUORUM, voteQuorum(3));
	assertEquals(GROUP_QUORUM, 2);
	assertEquals(GROUP_ROSTER.find((a) => a.isViewer)?.id, VIEWER_ATTENDEE_ID);
});

Deno.test("group: proposing opens a vote on the host's two new times, closing at the product's deadline", () => {
	const result = reduceBooking(createBooking(), { type: "propose_group" });
	assertEquals(result.outcome, { kind: "offered" });
	const { reschedule } = result.state.group;
	assertEquals(reschedule.status, "voting");
	assertEquals(reschedule.proposals.length, 2);
	assert(reschedule.proposals.every((p) => p.proposedByRole === "host" && p.approved));
	assert(reschedule.proposals.every((p) => canReschedule(BOOKING_NOW_MS, p.start)));
	assertEquals(reschedule.resolvesAt, voteResolvesAt(GROUP_OFFERS, GROUP_SESSION.startMs));
	// The earlier of 12 hours before the earliest option and the session's own lockout.
	assertEquals(reschedule.resolvesAt, GROUP_SESSION.startMs - RESCHEDULE_LOCKOUT_MS);
	assertEquals(result.state.view, "group");
	assertEquals(announcementFor(result), "The host offers two new times. Three attendees vote.");
	assertEquals(reduceBooking(result.state, { type: "propose_group" }).outcome, {
		kind: "refused",
		reason: "not_permitted",
	});
});

Deno.test("group: the host's vote is refused, and each attendee votes once", () => {
	const open = offered();
	assertEquals(reduceBooking(open, vote("att-maya", "prop-thu")).outcome, {
		kind: "refused",
		reason: "not_permitted",
	});
	const once = reduceBooking(open, vote(VIEWER_ATTENDEE_ID, "prop-fri"));
	assertEquals(once.outcome, {
		kind: "voted",
		attendeeId: VIEWER_ATTENDEE_ID,
		proposalId: "prop-fri",
	});
	assertEquals(reduceBooking(once.state, vote(VIEWER_ATTENDEE_ID, "prop-thu")).outcome, {
		kind: "refused",
		reason: "duplicate_vote",
	});
	assertEquals(reduceBooking(open, vote(VIEWER_ATTENDEE_ID, "prop-sat")).outcome, {
		kind: "refused",
		reason: "unknown_proposal",
	});
	assertEquals(reduceBooking(createBooking(), vote(VIEWER_ATTENDEE_ID, "prop-thu")).outcome, {
		kind: "refused",
		reason: "vote_closed",
	});
});

Deno.test("group: the tally reads votes of everyone entitled, and the majority line shows before the close", () => {
	const theo = reduceBooking(offered(), GROUP_SCRIPT[0]);
	assertEquals(announcementFor(theo), "Thu 22 Oct · 3:00 pm: 1 of 3 votes · needs 2.");
	assertFalse(groupView(theo.state).majority);
	const you = reduceBooking(theo.state, vote(VIEWER_ATTENDEE_ID, "prop-thu"));
	const view = groupView(you.state);
	assertEquals(view.options.map((o) => o.tally), [
		"2 of 3 votes · needs 2",
		"0 of 3 votes · needs 2",
	]);
	assert(view.majority);
	assertEquals(view.status, "voting", "a majority still waits for the close");
	assertEquals(
		announcementFor(you),
		"Thu 22 Oct · 3:00 pm: 2 of 3 votes · needs 2. More than half agree, so it moves when voting closes.",
	);
	assertEquals(view.voters.map((v) => [v.name, v.pick]), [
		["Maya", null],
		["You", "Thu"],
		["Theo", "Thu"],
		["Ines", null],
	]);
	assertFalse(view.canVote);
});

Deno.test("group: two of three for Thursday moves the session there when voting closes", () => {
	const voted = after([GROUP_SCRIPT[0], vote(VIEWER_ATTENDEE_ID, "prop-thu")], offered());
	const closed = reduceBooking(voted, { type: "close_voting" });
	assertEquals(closed.outcome, { kind: "resolved", proposalId: "prop-thu" });
	assertEquals(closed.state.group.startMs, GROUP_OFFERS[0].start);
	assertEquals(closed.state.nowMs, BOOKING_NOW_MS, "the rest of the example stays at its moment");
	assertEquals(closed.state.group.reschedule.resolvesAt, voted.group.reschedule.resolvesAt);
	// Moving the one-to-one is still refused as too late, never as a session that has passed.
	const booked = after([{ type: "pick", slotId: "slot-1500" }, { type: "book" }], closed.state);
	assertEquals(reduceBooking(booked, { type: "propose_one_to_one" }).outcome, {
		kind: "refused",
		reason: "inside_lockout",
	});
	assertEquals(announcementFor(closed), "Moved to Thu 3:00 pm");
	assertEquals(groupView(closed.state).outcome, "Moved to Thu 3:00 pm");
	// The same answer as the product's own settle.
	const product = settleVote(
		voted.group.reschedule.resolvesAt!,
		voted.group.reschedule,
		GROUP_ELIGIBLE,
		GROUP_SESSION.startMs,
	);
	assertEquals(product.status, "resolved");
	assertEquals(product.resolvedProposalId, "prop-thu");
	assertEquals(reduceBooking(closed.state, vote("att-ines", "prop-fri")).outcome, {
		kind: "refused",
		reason: "vote_closed",
	});
});

Deno.test("group: a split or a silence is no majority, and the original time stands", () => {
	for (
		const script of [
			[GROUP_SCRIPT[0], vote(VIEWER_ATTENDEE_ID, "prop-fri")],
			[GROUP_SCRIPT[0]],
			[],
		]
	) {
		const closed = reduceBooking(after(script, offered()), { type: "close_voting" });
		assertEquals(closed.outcome, { kind: "lapsed" });
		assertEquals(closed.state.group.startMs, GROUP_SESSION.startMs);
		assertEquals(announcementFor(closed), "No majority. The original time stands.");
		assertEquals(
			majorityProposal(closed.state.group.reschedule.proposals, GROUP_ELIGIBLE),
			null,
		);
	}
});

Deno.test("group: once everyone entitled has voted, the round settles without waiting", () => {
	const all = after(
		[GROUP_SCRIPT[0], vote(VIEWER_ATTENDEE_ID, "prop-thu"), vote("att-ines", "prop-fri")],
		offered(),
	);
	assertEquals(all.group.reschedule.status, "resolved");
	assertEquals(all.group.startMs, GROUP_OFFERS[0].start);
	assertEquals(all.nowMs, BOOKING_NOW_MS, "no clock moved");
});
// #endregion

// #region Calendar export (J12)
Deno.test("calendar: the moved session exports through the order's own links (Google, Outlook, a file)", () => {
	const links = calendarLinksFor({
		title: GROUP_SESSION.title,
		startIso: new Date(GROUP_OFFERS[0].start).toISOString(),
		durationMinutes: SESSION_MINUTES,
	}, "/api/checkout/calendar?line=example");
	assert(links.google.startsWith("https://calendar.google.com/"));
	assert(links.outlook.startsWith("https://outlook.live.com/"));
	assert(links.ics.startsWith("/"), "the file is same-origin");
	assertEquals(
		BOOKING_COPY.calendar,
		"Add it to Google Calendar, Outlook or any calendar app.",
	);
});
// #endregion

// #region Copy (§4.4, verbatim)
Deno.test("copy: the caption, description and microcopy are §4.4's words", () => {
	assertEquals(
		BOOKING_COPY.caption,
		"Pick a time in your time zone. Moving a group session? Attendees vote.",
	);
	assert(BOOKING_COPY.caption.split(/\s+/).length < 15, "a caption stays under 15 words");
	assertEquals(
		BOOKING_COPY.description,
		"Pick a session time from the freelancer's live availability, shown in your time zone. Moving a group session? Offer new times, and it moves only if more than half agree.",
	);
	assertEquals(BOOKING_COPY.propose, "Propose a new time");
	assertEquals(BOOKING_COPY.tally(2, 3, 2), "2 of 3 votes · needs 2");
	assertEquals(BOOKING_COPY.moved("Thu 3:00 pm"), "Moved to Thu 3:00 pm");
	assertEquals(BOOKING_COPY.lapsed, "No majority. The original time stands.");
	assertEquals(BOOKING_COPY.lockout, "Too late to move this. It starts in under 12 hours.");
});

Deno.test("copy: nothing banned, no sync, no absolutes", () => {
	const all = JSON.stringify(BOOKING_COPY).toLowerCase();
	for (
		const banned of [
			"until you approve",
			"only paid when you approve",
			"escrow",
			"sync",
			"real calendar",
			"release",
		]
	) {
		assertFalse(all.includes(banned), banned);
	}
});
// #endregion

// #region Frames
Deno.test("frames: six, captioned verbatim, each a state the reducer reaches", () => {
	const frames = bookingFrames();
	assertEquals(frames.map((f) => f.caption), [
		"Times show in your time zone. We tell you the freelancer's too.",
		"Taken times stay on the list, greyed out.",
		"Pick 3 pm. The session is booked, and your payment is held.",
		"Group session? The host offers two new times. Three attendees vote.",
		"Two of three pick Thursday. More than half agree, so it moves when voting closes.",
		"Add it to Google Calendar, Outlook or any calendar app.",
	]);
	assertEquals(frames.map((f) => f.focus), [
		"slots",
		"taken",
		"booked",
		"ballot",
		"ballot",
		"calendar",
	]);
});

Deno.test("frames: their words match their states (3 pm booked, two offers, two of three Thursday, moved)", () => {
	const [, , three, four, five, six] = bookingFrames();
	assertEquals(three.state.bookedId, FRAME_SLOT_ID);
	assertEquals(
		timeLabel(daySlots().find((s) => s.id === FRAME_SLOT_ID)!.startsAt, VIEWER_ZONE),
		"3:00 pm",
	);
	assertEquals(four.state.group.reschedule.proposals.length, 2);
	assertEquals(GROUP_ELIGIBLE, 3);
	const thursday = groupView(five.state).options[0];
	assertEquals(thursday.when.slice(0, 3), "Thu");
	assertEquals(thursday.votes, 2);
	assert(groupView(five.state).majority);
	assertEquals(six.state.group.reschedule.status, "resolved");
	assertEquals(groupView(six.state).outcome, "Moved to Thu 3:00 pm");
});
// #endregion

// #region Determinism
Deno.test("determinism: no clock is read, and a reduction never mutates its input", () => {
	const realNow = Date.now;
	Date.now = () => {
		throw new Error("the booking model read the clock");
	};
	try {
		const start = createBooking();
		const snapshot = structuredClone(start);
		const first = bookingFrames();
		const second = bookingFrames();
		assertEquals(first, second);
		const next = reduceBooking(start, { type: "propose_group" });
		assertNotStrictEquals(next.state, start);
		assertEquals(start, snapshot);
		const voted = reduceBooking(next.state, vote(VIEWER_ATTENDEE_ID, "prop-thu"));
		assertEquals(next.state.group.reschedule.proposals[0].votes.length, 0);
		assertEquals(voted.state.group.reschedule.proposals[0].votes.length, 1);
	} finally {
		Date.now = realNow;
	}
});

Deno.test("determinism: the shown half follows the visitor and never touches the rest", () => {
	const shown = reduceBooking(createBooking(), { type: "show", view: "group" });
	assertEquals(shown.outcome, { kind: "shown", view: "group" });
	assertEquals({ ...shown.state, view: "one_to_one" }, createBooking());
	assertEquals(announcementFor(shown), null);
});
// #endregion
