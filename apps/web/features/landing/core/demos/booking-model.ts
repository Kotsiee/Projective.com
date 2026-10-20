/**
 * booking-model — the demo stage's Booking tab (V4) as a pure simulation over typed fixtures
 * (`flows/LANDING.md` §4.4 Booking, §5 rows J2 and J8–J12, §6 V4). It never fetches and never
 * writes; every instant is a fixed epoch-ms fixture and nothing reads a clock, so the same actions
 * always land on the same state.
 *
 * The rules it mirrors are the product's own, imported rather than re-derived:
 *
 *   - **Times are absolute instants, shown in the viewer's zone** with the freelancer's zone named
 *     (J8): the fixture is a real `SlotGrid` (`@projective/types/scheduling` `booking.ts`) bucketed
 *     in London for a provider in New York, and every label is built from `zonedParts`, the
 *     product's own zone decomposition, so no browser locale changes a figure.
 *   - **Taken times stay on the list** (J9): an unavailable slot is in the grid with its reason, and
 *     picking it is refused, as `SlotPicker` refuses it; the reason lives only in its accessible name.
 *   - **Booking holds the payment** (J2). Single-select replaces the pick, as the booking modal's
 *     `toggleSlot` documents.
 *   - **Moving a session** is refused inside the 12-hour lockout (`canReschedule`, J11). A group of
 *     three or more settles by vote (`rescheduleModeFor`): the host offers at least two times
 *     (`canOpenVote`), every seat except the host's may vote once (`eligibleVoterCount`, the host
 *     never votes), a time carries with `voteQuorum` — more than half of everyone entitled, so an
 *     abstention counts against moving — and the round settles at its deadline (`voteResolvesAt`)
 *     or once everyone has voted, through `settleVote`: resolved with its winner, or lapsed with the
 *     original time standing (J10, Decision #71).
 *   - **Adding it to a calendar** is the order's calendar file export (`calendarLinksFor`, J12),
 *     never a calendar sync, which is not shipped.
 */
import type {
	BookableSlot,
	EventAttendee,
	EventReschedule,
	RescheduleProposal,
	RescheduleRefusalReason,
	SchedulingParty,
	SlotGrid,
} from "@projective/types/scheduling";
import {
	canOpenVote,
	canReschedule,
	dayKeyInZone,
	eligibleVoterCount,
	findSlot,
	isProposalOnBallot,
	majorityProposal,
	RESCHEDULE_LOCKOUT_HOURS,
	rescheduleModeFor,
	settleVote,
	slotsForDay,
	voteIsOpen,
	voteOf,
	voteQuorum,
	voteResolvesAt,
	zonedMidnight,
	zonedParts,
	zonedTimeToInstant,
} from "@projective/types/scheduling";

// #region Zones and labels
/** The visitor's zone in the example: you are in London (§4.4 fixture). */
export const VIEWER_ZONE = "Europe/London";

/** The freelancer's zone: they are in New York (§4.4 fixture). */
export const FREELANCER_ZONE = "America/New_York";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/** A zone's city, as the copy names it: `Europe/London` → "London", `America/New_York` → "New York". */
export function zoneCity(zone: string): string {
	const city = zone.slice(zone.lastIndexOf("/") + 1);
	return city.replace(/_/g, " ");
}

/** A clock time in a zone, en-GB twelve-hour: "3:00 pm". */
export function timeLabel(instant: number, zone: string): string {
	const { hour, minute } = zonedParts(instant, zone);
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	return `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** A day in a zone: "Tue 20 Oct". */
export function dayLabel(instant: number, zone: string): string {
	const { weekday, dayOfMonth, month } = zonedParts(instant, zone);
	return `${WEEKDAY_SHORT[weekday]} ${dayOfMonth} ${MONTH_SHORT[month]}`;
}

/** A day and a time in a zone: "Thu 22 Oct · 3:00 pm". */
export function whenLabel(instant: number, zone: string): string {
	return `${dayLabel(instant, zone)} · ${timeLabel(instant, zone)}`;
}

/** The weekday and the time, as the moved outcome names them: "Thu 3:00 pm". */
export function weekdayTimeLabel(instant: number, zone: string): string {
	return `${WEEKDAY_SHORT[zonedParts(instant, zone).weekday]} ${timeLabel(instant, zone)}`;
}

/** An instant from a wall-clock time in a zone (the product's own conversion, DST-safe). */
function wallClock(
	zone: string,
	year: number,
	month: number,
	day: number,
	hour: number,
	minute = 0,
): number {
	const midnight = zonedMidnight(Date.UTC(year, month, day, 12), zone);
	return zonedTimeToInstant(midnight, hour * 60 + minute, zone);
}
// #endregion

// #region Copy
/**
 * The tab's words, verbatim from `flows/LANDING.md` §4.4 Booking (rows J2, J8–J12) — and the
 * labels the demo adds to name its own controls. The live region reuses these strings.
 */
export const BOOKING_COPY = {
	/** The stage caption under the viewport (13 words; J8, J10). */
	caption: "Pick a time in your time zone. Moving a group session? Attendees vote.",
	/** The server-rendered description of the tab (J8, J10). */
	description:
		"Pick a session time from the freelancer's live availability, shown in your time zone. Moving a group session? Offer new times, and it moves only if more than half agree.",
	/** The zone note (J8), built from the two zones. */
	zoneNote: (viewer: string, freelancer: string): string =>
		`Times shown in your time zone (${zoneCity(viewer)}). The freelancer is in ${
			zoneCity(freelancer)
		}.`,
	/** The booking commit (a money verb: the payment is held). */
	book: (time: string): string => `Book ${time}`,
	/** After booking (J2). */
	booked: "The session is booked, and your payment is held.",
	/** The reschedule control. */
	propose: "Propose a new time",
	/** The 12-hour lockout (J11), from the product's own figure. */
	lockout: `Too late to move this. It starts in under ${RESCHEDULE_LOCKOUT_HOURS} hours.`,
	/** One ballot option's tally (J10). */
	tally: (votes: number, eligible: number, quorum: number): string =>
		`${votes} of ${eligible} votes · needs ${quorum}`,
	/** A carried vote, before the round closes (J10). */
	majority: "More than half agree, so it moves when voting closes.",
	/** The round's two endings (J10). */
	moved: (when: string): string => `Moved to ${when}`,
	lapsed: "No majority. The original time stands.",
	/** The host's offer, announced when the vote opens (J10). */
	offered: "The host offers two new times. Three attendees vote.",
	/** The calendar file export (J12). */
	calendar: "Add it to Google Calendar, Outlook or any calendar app.",
	/** Labels for the demo's own controls and columns (no claim). */
	labels: {
		oneToOne: "One-to-one session",
		group: "Group session",
		you: "You",
		freelancer: "The freelancer",
		pickHint: "Pick a time to book.",
		bookedStatus: "Booked",
		tryGroup: "Try a group session",
		backToBooking: "Back to booking",
		vote: "Vote for this",
		yourVote: "Your vote",
		chosen: "Chosen",
		host: "Host",
		waiting: "Waiting",
		closeVoting: "Skip to when voting closes",
		slotsGroup: (minutes: number): string => `Available times, ${minutes} minutes each`,
		ballot: "Proposed times",
		calendarApps: ["Google Calendar", "Outlook Calendar", "Apple Calendar", "Download .ics"],
		previous: "Previous step",
		next: "Next step",
		step: (n: number, total: number): string => `Step ${n} of ${total}`,
	},
	/** The frame mode's six frames (§4.4 Frames 1–6). */
	frames: [
		"Times show in your time zone. We tell you the freelancer's too.",
		"Taken times stay on the list, greyed out.",
		"Pick 3 pm. The session is booked, and your payment is held.",
		"Group session? The host offers two new times. Three attendees vote.",
		"Two of three pick Thursday. More than half agree, so it moves when voting closes.",
		"Add it to Google Calendar, Outlook or any calendar app.",
	],
} as const;
// #endregion

// #region Fixtures
/**
 * The example's "now": Tue 20 Oct 2026, 9:00 am in London (London is on BST and New York on EDT
 * until 25 Oct, five hours apart). Every rule is asked at this instant until the vote's deadline.
 */
export const BOOKING_NOW_MS: number = wallClock(VIEWER_ZONE, 2026, 9, 20, 9);

/** How long each session runs. */
export const SESSION_MINUTES = 60;

/**
 * The freelancer's minimum notice, in minutes: this provider set 2 hours. A provider sets their own
 * (`scheduling.call_settings.min_notice_minutes`, any value ≥ 0; the default is 720, 12 hours,
 * `DEFAULT_GRID_RULES`), and on a default schedule none of the afternoon's times would be open this
 * morning. With 2 hours' notice they are, and a session booked for this afternoon starts inside the
 * 12-hour reschedule lockout, so moving it is refused (J11) — the lockout and the notice are two
 * different rules.
 */
export const PROVIDER_MIN_NOTICE_MINUTES = 120;

const SESSION_MS = SESSION_MINUTES * 60_000;

/** One slot of the grid, at a London wall-clock hour on the example's day. */
function slotAt(hour: number, taken: boolean): BookableSlot {
	const startsAt = wallClock(VIEWER_ZONE, 2026, 9, 20, hour);
	return {
		id: `slot-${hour}00`,
		startsAt,
		endsAt: startsAt + SESSION_MS,
		available: !taken,
		reason: taken ? "taken" : null,
		seatsRemaining: null,
	};
}

/** The example day's four times: 2, 3, 4 and 5 pm in London (9 am to noon in New York). */
const DAY_SLOTS: readonly BookableSlot[] = [
	slotAt(14, true),
	slotAt(15, false),
	slotAt(16, true),
	slotAt(17, false),
];

/** The example day's key in the viewer's zone. */
export const BOOKING_DAY_KEY: string = dayKeyInZone(BOOKING_NOW_MS, VIEWER_ZONE);

/**
 * The freelancer's bookable grid, as the product's slot projection carries it (`SlotGrid`): one day
 * in the viewer's zone for a provider in New York, two of its four times already taken.
 */
export const BOOKING_GRID: SlotGrid = (() => {
	const midnight = zonedMidnight(BOOKING_NOW_MS, VIEWER_ZONE);
	const parts = zonedParts(BOOKING_NOW_MS, VIEWER_ZONE);
	return {
		purpose: "session",
		subjectId: "svc-brand-sprint",
		providerTimezone: FREELANCER_ZONE,
		viewerTimezone: VIEWER_ZONE,
		durationMinutes: SESSION_MINUTES,
		sessionCount: 1,
		days: [{
			key: BOOKING_DAY_KEY,
			startsAt: midnight,
			dayOfMonth: parts.dayOfMonth,
			weekday: parts.weekday,
			month: parts.month,
			year: parts.year,
			isToday: true,
			openCount: DAY_SLOTS.filter((s) => s.available).length,
			totalCount: DAY_SLOTS.length,
		}],
		slots: { [BOOKING_DAY_KEY]: [...DAY_SLOTS] },
		bands: {},
		bookableFrom: BOOKING_NOW_MS + PROVIDER_MIN_NOTICE_MINUTES * 60_000,
		windowStart: midnight,
		windowEnd: midnight + 14 * 86_400_000,
		closed: false,
		closedReason: null,
	};
})();

/** The freelancer, host of the group session (the same cast as the work board). */
export const HOST: SchedulingParty = {
	name: "Maya",
	avatar: "/test_images/profile_3.jpg",
	handle: null,
};

/** The group session's roster: the host plus three attendees, you among them. */
export const GROUP_ROSTER: readonly EventAttendee[] = [
	{
		...HOST,
		id: "att-maya",
		role: "host",
		response: "accepted",
		respondedAt: null,
		isViewer: false,
		note: null,
	},
	{
		name: "You",
		avatar: null,
		handle: null,
		id: "att-you",
		role: "participant",
		response: "accepted",
		respondedAt: null,
		isViewer: true,
		note: null,
	},
	{
		name: "Theo",
		avatar: "/test_images/profile_4.jpg",
		handle: null,
		id: "att-theo",
		role: "participant",
		response: "accepted",
		respondedAt: null,
		isViewer: false,
		note: null,
	},
	{
		name: "Ines",
		avatar: "/test_images/profile_5.jpg",
		handle: null,
		id: "att-ines",
		role: "participant",
		response: "accepted",
		respondedAt: null,
		isViewer: false,
		note: null,
	},
];

/** Your own seat on the roster. */
export const VIEWER_ATTENDEE_ID = "att-you";

/** The group session, booked for Wed 21 Oct, 6:00 pm in London. */
export const GROUP_SESSION = {
	title: "Brand workshop",
	startMs: wallClock(VIEWER_ZONE, 2026, 9, 21, 18),
	endMs: wallClock(VIEWER_ZONE, 2026, 9, 21, 18) + SESSION_MS,
} as const;

/** One of the host's two new times, on the ballot as it arrives (a host's slot needs no approval). */
function offerAt(id: string, day: number, hour: number): RescheduleProposal {
	const start = wallClock(VIEWER_ZONE, 2026, 9, day, hour);
	return {
		id,
		start,
		end: start + SESSION_MS,
		proposedBy: HOST,
		proposedByRole: "host",
		proposedAt: BOOKING_NOW_MS,
		approved: true,
		note: null,
		votes: [],
	};
}

/** The host's two new times: Thu 22 Oct and Fri 23 Oct, both 3:00 pm in London. */
export const GROUP_OFFERS: readonly RescheduleProposal[] = [
	offerAt("prop-thu", 22, 15),
	offerAt("prop-fri", 23, 15),
];

/**
 * The other attendees' votes, as the live demo plays them in after the host's offer: Theo picks
 * Thursday; Ines never votes, so her silence counts against moving.
 */
export const GROUP_SCRIPT: readonly VoteAction[] = [
	{ type: "vote", attendeeId: "att-theo", proposalId: "prop-thu" },
];

/** No negotiation yet: the group session's reschedule before anyone proposes. */
function quietReschedule(): EventReschedule {
	return {
		mode: rescheduleModeFor(GROUP_ROSTER.length),
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

// #region State
/** Which half of the demo is in front on a narrow stage (a wide stage shows both). */
export type BookingView = "one_to_one" | "group";

/** Why an action was refused. The reschedule reasons are the product's own codes. */
export type BookingRefusal =
	| "taken"
	| "unknown_slot"
	| "nothing_picked"
	| "already_booked"
	| "not_booked"
	| "outside_example"
	| RescheduleRefusalReason;

/** The group session as it stands: its current time and the reschedule round around it. */
export interface GroupSessionState {
	/** The session's current start; it moves when a round resolves. */
	readonly startMs: number;
	readonly endMs: number;
	readonly reschedule: EventReschedule;
}

/** The whole demo. */
export interface BookingState {
	/**
	 * The instant every rule is asked at. It never moves: skipping to the close settles the round at
	 * its own deadline (kept on the round as `resolvesAt`), and the rest of the example stays here.
	 */
	readonly nowMs: number;
	readonly view: BookingView;
	/** The picked slot, before booking. */
	readonly selectedId: string | null;
	/** The booked slot; once set, the pick is fixed. */
	readonly bookedId: string | null;
	/** The last refusal of moving the one-to-one session (the lockout), shown under its controls. */
	readonly oneToOneRefusal: RescheduleRefusalReason | null;
	readonly group: GroupSessionState;
}

/** The demo as it opens: nothing picked, the group session unmoved. */
export function createBooking(): BookingState {
	return {
		nowMs: BOOKING_NOW_MS,
		view: "one_to_one",
		selectedId: null,
		bookedId: null,
		oneToOneRefusal: null,
		group: {
			startMs: GROUP_SESSION.startMs,
			endMs: GROUP_SESSION.endMs,
			reschedule: quietReschedule(),
		},
	};
}
// #endregion

// #region Actions
/** One attendee's ballot. */
export interface VoteAction {
	readonly type: "vote";
	readonly attendeeId: string;
	readonly proposalId: string;
}

/** Everything a visitor (or the script) can do. */
export type BookingAction =
	| { readonly type: "pick"; readonly slotId: string }
	| { readonly type: "book" }
	| { readonly type: "propose_one_to_one" }
	| { readonly type: "show"; readonly view: BookingView }
	| { readonly type: "propose_group" }
	| VoteAction
	| { readonly type: "close_voting" };

/** What an action did — the UI announces from it. */
export type BookingOutcome =
	| { readonly kind: "picked"; readonly slotId: string }
	| { readonly kind: "unpicked"; readonly slotId: string }
	| { readonly kind: "booked"; readonly slotId: string }
	| { readonly kind: "shown"; readonly view: BookingView }
	| { readonly kind: "offered" }
	| {
		readonly kind: "voted";
		readonly attendeeId: string;
		readonly proposalId: string;
	}
	| { readonly kind: "resolved"; readonly proposalId: string }
	| { readonly kind: "lapsed" }
	| { readonly kind: "refused"; readonly reason: BookingRefusal };

/** A reduction: the next state and what happened. A refusal leaves the state as it was. */
export interface BookingResult {
	readonly state: BookingState;
	readonly outcome: BookingOutcome;
}

/** Eligible voters on the group session: everyone but the host. */
export const GROUP_ELIGIBLE: number = eligibleVoterCount(GROUP_ROSTER);

/** The votes one time needs to carry. */
export const GROUP_QUORUM: number = voteQuorum(GROUP_ELIGIBLE);

const refuse = (state: BookingState, reason: BookingRefusal): BookingResult => ({
	state,
	outcome: { kind: "refused", reason },
});

/**
 * The group state after a settle asked at `atMs`: a resolved round moves the session to its winner,
 * a lapsed one leaves it where it was; `null` while the round is still open.
 */
function settled(state: BookingState, atMs: number): BookingResult | null {
	const { group } = state;
	const next = settleVote(atMs, group.reschedule, GROUP_ELIGIBLE, group.startMs);
	if (next === group.reschedule || next.status === "voting") return null;
	if (next.status === "resolved") {
		const winner = next.proposals.find((p) => p.id === next.resolvedProposalId);
		if (!winner) return null;
		return {
			state: {
				...state,
				group: { startMs: winner.start, endMs: winner.end, reschedule: next },
			},
			outcome: { kind: "resolved", proposalId: winner.id },
		};
	}
	return {
		state: { ...state, group: { ...group, reschedule: next } },
		outcome: { kind: "lapsed" },
	};
}

/**
 * Apply one action. Pure and total: an action the rules refuse returns the state unchanged with
 * the refusal as its outcome.
 */
export function reduceBooking(state: BookingState, action: BookingAction): BookingResult {
	switch (action.type) {
		case "pick": {
			if (state.bookedId !== null) return refuse(state, "already_booked");
			const slot = findSlot(BOOKING_GRID, action.slotId);
			if (!slot) return refuse(state, "unknown_slot");
			if (!slot.available) return refuse(state, "taken");
			if (state.selectedId === slot.id) {
				return {
					state: { ...state, selectedId: null },
					outcome: { kind: "unpicked", slotId: slot.id },
				};
			}
			return {
				state: { ...state, selectedId: slot.id },
				outcome: { kind: "picked", slotId: slot.id },
			};
		}
		case "book": {
			if (state.bookedId !== null) return refuse(state, "already_booked");
			if (state.selectedId === null) return refuse(state, "nothing_picked");
			return {
				state: { ...state, bookedId: state.selectedId },
				outcome: { kind: "booked", slotId: state.selectedId },
			};
		}
		case "propose_one_to_one": {
			const booked = state.bookedId ? findSlot(BOOKING_GRID, state.bookedId) : null;
			if (!booked) return refuse(state, "not_booked");
			if (!canReschedule(state.nowMs, booked.startsAt)) {
				return refuse({ ...state, oneToOneRefusal: "inside_lockout" }, "inside_lockout");
			}
			// Two people settle a move between them; every time in this example sits inside the
			// lockout, so the example shows only the refusal.
			return refuse(state, "outside_example");
		}
		case "show":
			return {
				state: { ...state, view: action.view },
				outcome: { kind: "shown", view: action.view },
			};
		case "propose_group": {
			const { group } = state;
			if (group.reschedule.status !== "none") return refuse(state, "not_permitted");
			if (!canReschedule(state.nowMs, group.startMs)) return refuse(state, "inside_lockout");
			const proposals = GROUP_OFFERS.map((p) => ({ ...p, votes: [] }));
			if (!proposals.every((p) => canReschedule(state.nowMs, p.start))) {
				return refuse(state, "proposal_inside_lockout");
			}
			if (!canOpenVote(proposals)) return refuse(state, "not_enough_proposals");
			const reschedule: EventReschedule = {
				...group.reschedule,
				status: "voting",
				openedBy: HOST,
				openedAt: state.nowMs,
				proposals,
				resolvesAt: voteResolvesAt(proposals, group.startMs),
			};
			return {
				state: { ...state, view: "group", group: { ...group, reschedule } },
				outcome: { kind: "offered" },
			};
		}
		case "vote": {
			const { group } = state;
			const { reschedule } = group;
			if (
				reschedule.status !== "voting" ||
				!voteIsOpen(state.nowMs, reschedule.proposals, group.startMs)
			) {
				return refuse(state, "vote_closed");
			}
			const voter = GROUP_ROSTER.find((a) => a.id === action.attendeeId);
			if (!voter || voter.role === "host") return refuse(state, "not_permitted");
			const choice = reschedule.proposals.find((p) => p.id === action.proposalId);
			if (!choice || !isProposalOnBallot(choice)) return refuse(state, "unknown_proposal");
			if (voteOf(reschedule.proposals, voter.id)) return refuse(state, "duplicate_vote");
			const ballot = {
				attendeeId: voter.id,
				name: voter.name,
				avatar: voter.avatar,
				handle: voter.handle,
				at: state.nowMs,
			};
			const voted: BookingState = {
				...state,
				group: {
					...group,
					reschedule: {
						...reschedule,
						proposals: reschedule.proposals.map((p) =>
							p.id === choice.id ? { ...p, votes: [...p.votes, ballot] } : p
						),
					},
				},
			};
			// Once everyone entitled has voted the result cannot change, so it settles now.
			const done = settled(voted, voted.nowMs);
			return done ?? {
				state: voted,
				outcome: { kind: "voted", attendeeId: voter.id, proposalId: choice.id },
			};
		}
		case "close_voting": {
			const { reschedule } = state.group;
			if (reschedule.status !== "voting" || reschedule.resolvesAt === null) {
				return refuse(state, "vote_closed");
			}
			const closes = Math.max(state.nowMs, reschedule.resolvesAt);
			return settled(state, closes) ?? refuse(state, "vote_closed");
		}
	}
}

/** Run a script of actions from a state, keeping every intermediate state. */
export function runBooking(
	from: BookingState,
	actions: readonly BookingAction[],
): BookingState[] {
	const states = [from];
	let current = from;
	for (const action of actions) {
		current = reduceBooking(current, action).state;
		states.push(current);
	}
	return states;
}
// #endregion

// #region Views
/** The day's slots, in order. */
export function daySlots(): readonly BookableSlot[] {
	return slotsForDay(BOOKING_GRID, BOOKING_DAY_KEY);
}

/** A slot by id on the example grid. */
export function slotById(slotId: string | null): BookableSlot | null {
	return slotId ? findSlot(BOOKING_GRID, slotId) : null;
}

/**
 * A slot's accessible name, as the product's `SlotPicker` builds it: the time and the length, or
 * the time and why it cannot be taken — the reason is never shown, only named (J9).
 */
export function slotSummary(slot: BookableSlot, zone: string): string {
	const time = timeLabel(slot.startsAt, zone);
	if (!slot.available) {
		const why = slot.reason === "taken"
			? "already booked"
			: slot.reason === "blackout"
			? "the provider is away"
			: slot.reason === "inside_minimum_notice"
			? "too soon to book"
			: slot.reason === "past"
			? "already passed"
			: slot.reason === "full"
			? "every seat taken"
			: "unavailable";
		return `${time}, ${why}`;
	}
	return `${time}, ${BOOKING_GRID.durationMinutes} minutes`;
}

/** One ballot option as the demo draws it. */
export interface BallotOptionView {
	readonly id: string;
	readonly when: string;
	readonly votes: number;
	/** "{votes} of {eligible} votes · needs {quorum}". */
	readonly tally: string;
	/** Votes as a share of the quorum, 0–1 — how close the time is to carrying. */
	readonly share: number;
	readonly carried: boolean;
	readonly won: boolean;
	readonly mine: boolean;
}

/** One attendee as the ballot's roster shows them. */
export interface VoterView {
	readonly id: string;
	readonly name: string;
	readonly avatar: string | null;
	readonly host: boolean;
	readonly isViewer: boolean;
	/** The weekday they picked ("Thu"), or `null` while they have not voted (and always for the host). */
	readonly pick: string | null;
}

/** The group session as the demo draws it. */
export interface GroupView {
	readonly when: string;
	readonly status: EventReschedule["status"];
	readonly options: readonly BallotOptionView[];
	readonly voters: readonly VoterView[];
	/** A time already holds a majority while voting is still open. */
	readonly majority: boolean;
	/** Whether you may still vote. */
	readonly canVote: boolean;
	/** The ending, once the round has closed: "Moved to Thu 3:00 pm" or the lapsed line. */
	readonly outcome: string | null;
}

/** The group session's view at a state. */
export function groupView(state: BookingState): GroupView {
	const { group } = state;
	const { reschedule } = group;
	const proposals = reschedule.proposals;
	const lead = majorityProposal(proposals, GROUP_ELIGIBLE);
	const open = reschedule.status === "voting" &&
		voteIsOpen(state.nowMs, proposals, group.startMs);
	const mine = voteOf(proposals, VIEWER_ATTENDEE_ID);
	const options = proposals.map((p): BallotOptionView => ({
		id: p.id,
		when: whenLabel(p.start, VIEWER_ZONE),
		votes: p.votes.length,
		tally: BOOKING_COPY.tally(p.votes.length, GROUP_ELIGIBLE, GROUP_QUORUM),
		share: Math.min(1, p.votes.length / GROUP_QUORUM),
		carried: p.votes.length >= GROUP_QUORUM,
		won: reschedule.status === "resolved" && reschedule.resolvedProposalId === p.id,
		mine: mine?.id === p.id,
	}));
	const voters = GROUP_ROSTER.map((a): VoterView => {
		const pick = a.role === "host" ? null : voteOf(proposals, a.id);
		return {
			id: a.id,
			name: a.name,
			avatar: a.avatar,
			host: a.role === "host",
			isViewer: a.isViewer,
			pick: pick ? WEEKDAY_SHORT[zonedParts(pick.start, VIEWER_ZONE).weekday] : null,
		};
	});
	const outcome = reschedule.status === "resolved"
		? BOOKING_COPY.moved(weekdayTimeLabel(group.startMs, VIEWER_ZONE))
		: reschedule.status === "lapsed"
		? BOOKING_COPY.lapsed
		: null;
	return {
		when: whenLabel(group.startMs, VIEWER_ZONE),
		status: reschedule.status,
		options,
		voters,
		majority: open && lead !== null,
		canVote: open && mine === null,
		outcome,
	};
}

/**
 * What the live region says after an action, or `null` when the control's own state already says
 * it (a pressed slot announces itself; a refused taken slot is named for its reason).
 */
export function announcementFor(result: BookingResult): string | null {
	const { state, outcome } = result;
	switch (outcome.kind) {
		case "booked":
			return BOOKING_COPY.booked;
		case "offered":
			return BOOKING_COPY.offered;
		case "voted": {
			const option = groupView(state).options.find((o) => o.id === outcome.proposalId);
			if (!option) return null;
			const line = `${option.when}: ${option.tally}.`;
			return groupView(state).majority ? `${line} ${BOOKING_COPY.majority}` : line;
		}
		case "resolved":
			return BOOKING_COPY.moved(weekdayTimeLabel(state.group.startMs, VIEWER_ZONE));
		case "lapsed":
			return BOOKING_COPY.lapsed;
		case "refused":
			return outcome.reason === "inside_lockout" ? BOOKING_COPY.lockout : null;
		default:
			return null;
	}
}
// #endregion

// #region Frames
/** Which part of the demo a frame shows. */
export type BookingFrameFocus = "slots" | "taken" | "booked" | "ballot" | "calendar";

/** One frame of the frame mode: its caption (§4.4) and the state it shows. */
export interface BookingFrame {
	readonly caption: string;
	readonly focus: BookingFrameFocus;
	readonly state: BookingState;
}

/** The slot the frames book: 3:00 pm in London (frame 3, "Pick 3 pm"). */
export const FRAME_SLOT_ID = "slot-1500";

/**
 * The six frames (§4.4 Frames 1–6), each the reducer's own state: the open grid; the same grid with
 * its taken times; 3 pm booked; the host's two new times on the ballot; Theo and you picking
 * Thursday; the round closed and the session moved, ready to add to a calendar.
 */
export function bookingFrames(): BookingFrame[] {
	const open = createBooking();
	const [, , booked] = runBooking(open, [{ type: "pick", slotId: FRAME_SLOT_ID }, {
		type: "book",
	}]);
	const [, ballot, , twoThursdays, closed] = runBooking(booked, [
		{ type: "propose_group" },
		{ type: "vote", attendeeId: "att-theo", proposalId: "prop-thu" },
		{ type: "vote", attendeeId: VIEWER_ATTENDEE_ID, proposalId: "prop-thu" },
		{ type: "close_voting" },
	]);
	const [one, two, three, four, five, six] = BOOKING_COPY.frames;
	return [
		{ caption: one, focus: "slots", state: open },
		{ caption: two, focus: "taken", state: open },
		{ caption: three, focus: "booked", state: booked },
		{ caption: four, focus: "ballot", state: ballot },
		{ caption: five, focus: "ballot", state: twoThursdays },
		{ caption: six, focus: "calendar", state: closed },
	];
}
// #endregion
