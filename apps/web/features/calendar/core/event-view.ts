import { createModalStack } from "@projective/ui/overlay";
import type { IconName } from "@projective/ui/icons";
import type { MoneyView } from "@projective/types/finance";
import type {
	CalendarEvent,
	CalendarEventKind,
	EventLiveStatus,
	RescheduleMode,
	RescheduleProposal,
	RescheduleRefusalReason,
	RescheduleStatus,
} from "@projective/types/scheduling";
import {
	ballotProposals,
	canOpenVote,
	canReschedule,
	eligibleVoterCount,
	eventLiveStatus,
	isProposalOnBallot,
	isRescheduleClosed,
	leadingProposal,
	majorityProposal,
	RESCHEDULE_REFUSAL_COPY,
	rescheduleLockoutAt,
	rescheduleModeFor,
	viewerAttendee,
	voteIsOpen,
	voteOf,
	voteQuorum,
} from "@projective/types/scheduling";
import type { EventAccess } from "./event-access.ts";

/**
 * event-view — the pure model behind the Event Modal: its modal-stack instance, its tab vocabulary,
 * and the projections a tab renders.
 *
 * **No rule is implemented here.** Every predicate about whether something may happen is imported
 * from the scheduling SSOT (`@projective/types/scheduling` `./coordination.ts`) and CALLED — the
 * 12-hour lockout, the two-slot minimum, the host-approval gate, the majority threshold, the vote
 * deadline. That is deliberate: the fat `ScheduleBackendService` applies the very same functions, so
 * a refusal this surface predicts and a refusal the server issues cannot disagree, and the refusal
 * COPY comes from {@link RESCHEDULE_REFUSAL_COPY} rather than being written twice.
 *
 * The guards are evaluated in the SERVER's order, refusal for refusal, including the closed-round
 * check that `ScheduleBackendService.reschedule` applies before any per-action seat test. Two rules
 * this module deliberately does NOT hold are the ones the server has no opinion on: re-opening a
 * round that is already out, and withdrawing one that was never opened, are both accepted by the
 * service (re-opening is idempotent). Refusing them here would be a second rule; instead the tab
 * simply does not OFFER a control whose effect would be a no-op — a presentation choice, made where
 * presentation choices belong.
 *
 * The one thing this module owns is presentation: which tabs exist for which seat, which panel a tab
 * has something to say in, and how a duration reads.
 */

// #region Modal stack
/**
 * The frames this surface can open. A second, independent stack from the ticket board's — one chain
 * per surface, never a global singleton, because two surfaces sharing a chain would let a "back" from
 * an event return to a ticket the viewer never looked at.
 */
export type EventFrameKind = "event";

/** What opening a frame needs to know that its id does not carry. */
export interface EventFrameInput {
	/** Composing a new entry rather than reading an existing one. */
	mode?: EventMode;
}

/**
 * Module-level, because the calendar body and the modal are the same hydration root but different
 * subtrees. Its cache is a plain `Map` and `write()` does not notify — load-bearing, so a scroll
 * write or a keystroke into a cached field cannot invalidate the frame list and re-render the host.
 */
export const eventStack = createModalStack<EventFrameKind, EventFrameInput>();
// #endregion

// #region Mode + tabs
/** Whether this occurrence exists yet. The only thing that differs, and it differs in three places. */
export type EventMode = "create" | "view";

/** The modal's views, in reading order. */
export type EventTab = "details" | "reschedule" | "attachments" | "finances" | "history";

/** One entry in the tab strip. */
export interface EventTabSpec {
	key: EventTab;
	label: string;
	icon: IconName;
	/** A figure worth opening the tab for; `null` when there is nothing to count. */
	count: number | null;
	/** Drop the visible label and push the tab to the far end (§B.6). */
	iconOnly: boolean;
}

/**
 * Which tabs this event, seat and mode have.
 *
 * Three rules, each an absence rather than a disabled control:
 *
 *  - **Composing shows Details alone.** An empty archive and an empty pack on a thing that does not
 *    exist yet invite the reader to wonder what they missed.
 *  - **Finances is provider-side.** It is the HOST's earnings from an occurrence, so a buyer has no
 *    business in it — what a seat costs THEM is in the footer, where a buyer's money belongs. A seat
 *    without the right does not see the tab, because a locked tab advertises a capability and then
 *    refuses it.
 *  - **Reschedule and the pack need a party.** A stranger receives neither a roster nor a
 *    negotiation (the privacy projection withholds both), so the tabs would be empty by construction.
 */
export function eventTabs(
	event: CalendarEvent,
	mode: EventMode,
	access: EventAccess,
): EventTabSpec[] {
	if (mode === "create") {
		return [{ key: "details", label: "Details", icon: "document", count: null, iconOnly: false }];
	}

	const party = isEventPartyView(event);
	const tabs: EventTabSpec[] = [
		{ key: "details", label: "Details", icon: "document", count: null, iconOnly: false },
	];

	if (party && event.reschedule) {
		tabs.push({
			key: "reschedule",
			label: "Reschedule",
			icon: "clock",
			count: ballotProposals(event.reschedule.proposals).length || null,
			iconOnly: false,
		});
	}
	if (party) {
		tabs.push({
			key: "attachments",
			label: "Attachments",
			icon: "attachment",
			count: event.attachments?.length || null,
			iconOnly: false,
		});
	}
	if (party && access.isFreelancer && event.pricing) {
		tabs.push({ key: "finances", label: "Finances", icon: "wallet", count: null, iconOnly: false });
	}
	if (party && event.history && event.history.length > 0) {
		tabs.push({ key: "history", label: "History", icon: "history", count: null, iconOnly: true });
	}
	return tabs;
}

/** What the side panel says on a given tab, or `null` where it has nothing to say. */
export type EventPanelKind = "attendees" | null;

/**
 * The panel follows the tab, and appears only where it adds a second answer: who is coming, while
 * you read the agenda or weigh a proposed time. On the pack, the ledger and the archive it would be
 * a column that is usually irrelevant, which teaches the reader to ignore that side.
 */
export function panelFor(tab: EventTab): EventPanelKind {
	return tab === "details" || tab === "reschedule" ? "attendees" : null;
}
// #endregion

/** Per-session counter behind a draft's id; see {@link blankEvent}. */
let draftSeq = 0;

/**
 * A blank entry over a range the reader selected on the grid.
 *
 * Deliberately carries NO coordination — no roster, no room, no negotiation, no log. Those are things
 * that happen to an occurrence once it exists; minting an empty one would put a "0 attending" badge
 * and an empty archive in front of somebody who has not typed a title yet.
 *
 * The id is client-minted and provisional, exactly as the retired dialog's was. It is the modal
 * stack's frame key and nothing more — persistence lands with the backend gate, and the server will
 * mint the real one.
 *
 * It carries a sequence because the range alone is NOT unique: two meetings in the same slot is a
 * legitimate thing to book, and both islands add-or-replace on `id`, so a second draft over the same
 * span used to REPLACE the first entry instead of joining it on the grid.
 */
export function blankEvent(
	range: { start: number; end: number; allDay?: boolean },
	kind: CalendarEventKind,
): CalendarEvent {
	return {
		id: `draft-${range.start}-${range.end}-${++draftSeq}`,
		title: "",
		kind,
		status: "confirmed",
		start: range.start,
		end: range.end,
		...(range.allDay ? { allDay: true } : {}),
	};
}

// #region Viewer seating (read from what the SERVER sent, never re-derived)
/**
 * Is the acting viewer a party to this event?
 *
 * Answered from the SHAPE of the payload, which is the privacy contract itself: the service strips
 * `roster` from anyone who is not a party, so a payload that carries one was sent to somebody who is.
 * A client-side handle comparison would be both weaker and wrong on a team-owned engagement.
 */
export function isEventPartyView(event: CalendarEvent): boolean {
	return Array.isArray(event.roster);
}

/** The acting viewer's own roster row, or `null` when they have no seat. */
export function viewerSeat(event: CalendarEvent) {
	return viewerAttendee(event.roster ?? []);
}
// #endregion

// #region Live status
/** The dynamic header badge: what it says, and the tone that reinforces it. */
export interface EventBadge {
	label: string;
	tone: "progress" | "info" | "muted";
	/** The spoken form, which always names the exact start rather than a rounded countdown. */
	title: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * How the badge reads at `nowMs`.
 *
 * The unit degrades with distance on purpose. "Upcoming in 0 hours" is not an answer, and neither is
 * "upcoming in 312 hours" — so under an hour it counts minutes, under two days it counts hours, and
 * beyond that days. Every boundary favours the LATER state, matching {@link eventLiveStatus}: at the
 * start it is running, at the end it has passed.
 */
export function eventBadge(status: EventLiveStatus, whenLabel: string): EventBadge {
	if (status.state === "running") {
		return { label: "Running now", tone: "progress", title: `In progress until ${whenLabel}` };
	}
	if (status.state === "passed") {
		return { label: "Passed", tone: "muted", title: `Finished — ${whenLabel}` };
	}
	const ms = status.msUntilStart;
	if (ms < MINUTE_MS) {
		return { label: "Starting now", tone: "progress", title: `Starts at ${whenLabel}` };
	}
	if (ms < HOUR_MS) {
		const mins = Math.round(ms / MINUTE_MS);
		return {
			label: `Upcoming in ${mins} ${mins === 1 ? "minute" : "minutes"}`,
			tone: "info",
			title: `Starts at ${whenLabel}`,
		};
	}
	if (ms < 48 * HOUR_MS) {
		const hours = Math.round(status.hoursUntilStart);
		return {
			label: `Upcoming in ${hours} ${hours === 1 ? "hour" : "hours"}`,
			tone: "info",
			title: `Starts at ${whenLabel}`,
		};
	}
	const days = Math.round(ms / (24 * HOUR_MS));
	return {
		label: `Upcoming in ${days} days`,
		tone: "info",
		title: `Starts at ${whenLabel}`,
	};
}

/**
 * The dirty-tracking hash for the STAGED fields, and only those.
 *
 * An event's roster, negotiation and audit log are the server's; they change under the reader while
 * they are looking at it, and comparing them here would report "you have unsaved changes" because
 * somebody else voted. What the reader can edit on this surface is the title, WHEN IT RUNS, the
 * agenda, the room and the pack — so those are what "has anything changed" measures.
 *
 * The two instants are load-bearing, not decorative: the meta bar's pickers stage a moved time onto
 * the same working copy every other edit lands on, and a fingerprint blind to them would leave the
 * footer showing no Save — so the reader's new time would be silently dropped when the frame closed.
 * They are joined into ONE entry so two adjacent numbers can never read as a third.
 *
 * Order-sensitive on the pack, because reordering IS an edit.
 */
export function eventFingerprint(event: CalendarEvent): string {
	const meeting = event.meeting;
	return [
		`${event.start}-${event.end}`,
		event.title.trim(),
		event.kind,
		event.location ?? "",
		event.description ?? "",
		meeting
			? [
				meeting.provider,
				meeting.providerLabel,
				meeting.joinUrl ?? "",
				meeting.passcode ?? "",
				meeting.details ?? "",
			].join("")
			: "",
		(event.attachments ?? []).map((a) => `${a.id}:${a.name}`).join(""),
	].join("");
}

/**
 * How long the occurrence runs, in the coarsest unit that is still exact — or `null` when it does not
 * run for any length of time at all.
 *
 * A DEADLINE is a point in time (`end === start`), and "0 min" is not a shorter way of saying that: it
 * reads as a measurement, and a measurement of zero invites the reader to wonder what went wrong.
 * Returning `null` lets each surface fall back to the one thing that IS true — the moment itself —
 * rather than printing a duration the event does not have.
 */
export function durationLabel(startMs: number, endMs: number): string | null {
	const mins = Math.max(0, Math.round((endMs - startMs) / MINUTE_MS));
	if (mins <= 0) return null;
	if (mins < 60) return `${mins} min`;
	const hours = Math.floor(mins / 60);
	const rest = mins % 60;
	if (rest === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
	return `${hours}h ${rest}m`;
}
// #endregion

// #region The reschedule negotiation, projected for a surface
/** One offered action: whether it is available, and — when it is not — why not, in the SSOT's words. */
export interface RescheduleGate {
	allowed: boolean;
	/**
	 * The machine-readable refusal, so a surface can tell a STATE refusal ("too close to the start")
	 * from a SEAT refusal ("not your job") without matching on prose. The two render differently:
	 * a state refusal is a disabled control with the reason beside it, a seat refusal is absence.
	 */
	code: RescheduleRefusalReason | null;
	/** The refusal, taken verbatim from {@link RESCHEDULE_REFUSAL_COPY}; `null` while allowed. */
	reason: string | null;
}

/** Whether a gate is refused because it is not this seat's job, rather than because of the state. */
export function isSeatRefusal(gate: RescheduleGate): boolean {
	return gate.code === "not_permitted";
}

/** Everything the Reschedule tab renders, derived once so no control decides for itself. */
export interface RescheduleView {
	mode: RescheduleMode;
	status: RescheduleStatus;
	/**
	 * This round has ended ({@link isRescheduleClosed}) — nothing further can be asked of it, and only
	 * a fresh `propose` opens the next one. Exposed so a surface can decide what to OFFER without
	 * re-testing a status list of its own.
	 */
	closed: boolean;
	/** Every proposal, including a client's that is still waiting on the host. */
	proposals: RescheduleProposal[];
	/** The subset that can actually be chosen. */
	ballot: RescheduleProposal[];
	/** The proposal the acting seat backed; `null` when they have not voted. */
	myVoteId: string | null;
	/** Everyone entitled to vote — the host is not, having authored the options. */
	voters: number;
	/** Votes one slot needs to carry: strictly more than half of {@link voters}. */
	quorum: number;
	/** Epoch ms the vote closes; `null` off a vote. */
	resolvesAt: number | null;
	/** Epoch ms after which nothing can be moved at all. */
	lockoutAt: number;
	/** Currently ahead on the ballot; `null` when nothing has been voted for. */
	leaderId: string | null;
	/** Has actually carried; `null` until one does. */
	winnerId: string | null;
	/** The slot a settled round chose; `null` unless resolved. */
	resolvedId: string | null;
	propose: RescheduleGate;
	open: RescheduleGate;
	vote: RescheduleGate;
	confirm: RescheduleGate;
	withdraw: RescheduleGate;
	approve: RescheduleGate;
}

const OK: RescheduleGate = { allowed: true, code: null, reason: null };
function no(code: RescheduleRefusalReason): RescheduleGate {
	return { allowed: false, code, reason: RESCHEDULE_REFUSAL_COPY[code] };
}

/**
 * Project an event's negotiation for the surface that renders it.
 *
 * The order of the guards mirrors `ScheduleBackendService.reschedule` exactly — passed, then the
 * lockout, then membership, then the closed round — because a surface that checks them in a
 * different order will eventually explain a refusal with a reason that is true but not the one the
 * server would have given.
 */
export function rescheduleView(
	event: CalendarEvent,
	nowMs: number,
): RescheduleView {
	const roster = event.roster ?? [];
	const negotiation = event.reschedule;
	const mode: RescheduleMode = negotiation?.mode ?? rescheduleModeFor(roster.length);
	const proposals = negotiation?.proposals ?? [];
	const ballot = ballotProposals(proposals);
	const voters = eligibleVoterCount(roster);
	const me = viewerAttendee(roster);
	const isHost = event.viewerIsHost === true;
	const status: RescheduleStatus = negotiation?.status ?? "none";

	const live = eventLiveStatus(nowMs, event.start, event.end);
	const closed = isRescheduleClosed(status);

	/** The refusal that applies to EVERY action, or `null` when none does. */
	const blanket: RescheduleGate | null = live.state === "passed"
		? no("event_passed")
		: !canReschedule(nowMs, event.start)
		? no("inside_lockout")
		: !isEventPartyView(event)
		? no("not_permitted")
		: null;

	const gate = (own: () => RescheduleGate): RescheduleGate => blanket ?? own();

	const winner = mode === "vote" ? majorityProposal(proposals, voters) : null;

	return {
		mode,
		status,
		closed,
		proposals: [...proposals],
		ballot,
		myVoteId: me ? voteOf(proposals, me.id)?.id ?? null : null,
		voters,
		quorum: voteQuorum(voters),
		resolvesAt: negotiation?.resolvesAt ?? null,
		lockoutAt: rescheduleLockoutAt(event.start),
		leaderId: leadingProposal(proposals)?.id ?? null,
		winnerId: winner?.id ?? null,
		resolvedId: negotiation?.resolvedProposalId ?? null,

		/*
		 * Proposing is the one action a closed round still admits — it opens the next one.
		 *
		 * This gate answers only "may this seat offer a time at all". Whether a PARTICULAR slot may be
		 * offered is a second question, because the server applies the lockout twice — once to the
		 * event being moved and again to the slot being offered — so the candidate is judged by
		 * {@link proposalGate} at the point the surface actually has one.
		 */
		propose: gate(() => OK),

		open: gate(() => {
			if (closed) return no("vote_closed");
			if (!isHost) return no("not_permitted");
			if (mode === "vote" ? !canOpenVote(proposals) : proposals.length === 0) {
				return no("not_enough_proposals");
			}
			if (mode === "vote" && !voteIsOpen(nowMs, proposals)) return no("vote_closed");
			return OK;
		}),

		vote: gate(() => {
			if (closed) return no("vote_closed");
			if (mode !== "vote" || status !== "voting") return no("vote_closed");
			if (isHost || !me) return no("not_permitted");
			if (!voteIsOpen(nowMs, proposals)) return no("vote_closed");
			if (proposals.some((p) => p.votes.some((v) => v.attendeeId === me.id))) {
				return no("duplicate_vote");
			}
			return OK;
		}),

		confirm: gate(() => {
			if (closed) return no("vote_closed");
			if (mode === "counterparty") {
				// The party who did NOT offer the time is the one who accepts it.
				if (isHost) return no("not_permitted");
				if (!ballot.some(isProposalOnBallot)) return no("proposal_not_approved");
				return OK;
			}
			if (!isHost) return no("not_permitted");
			if (status !== "voting") return no("vote_closed");
			if (!winner) return no("no_majority");
			return OK;
		}),

		withdraw: gate(() => {
			if (closed) return no("vote_closed");
			if (!isHost) return no("not_permitted");
			return OK;
		}),

		approve: gate(() => {
			// The closed check is the SERVICE's blanket one (it precedes every per-action seat test but
			// `propose`), and it was missing here — so a host looking at an unapproved slot on a lapsed
			// or resolved round was offered an enabled "Put it on the ballot" that the server refuses
			// with `vote_closed`. Ordered first for the same reason it is first there.
			if (closed) return no("vote_closed");
			return isHost ? OK : no("not_permitted");
		}),
	};
}

/**
 * Whether ONE candidate slot may be offered, at `nowMs`.
 *
 * The lockout applies twice and the surface used to apply it once. `ScheduleBackendService.reschedule`
 * refuses `inside_lockout` for the event being moved AND `proposal_inside_lockout` for the slot being
 * offered — because a time three hours out would arrive with its own vote deadline already in the
 * past, so the ballot would open closed and could elect a slot that is itself already unmovable. With
 * only the first check the surface enabled a submit for a slot the server was always going to refuse,
 * which is precisely the disagreement this module exists to make impossible.
 *
 * `base` short-circuits: a seat or blanket refusal is the reason the reader needs, and re-explaining
 * it as a bad slot would name the wrong problem. `null` means nothing has been picked yet, which is
 * not a refusal — the submit is gated on having a slot separately.
 */
export function proposalGate(
	base: RescheduleGate,
	nowMs: number,
	startMs: number | null,
): RescheduleGate {
	if (!base.allowed || startMs === null) return base;
	return canReschedule(nowMs, startMs) ? OK : no("proposal_inside_lockout");
}
// #endregion

// #region Money perspective
/** Which figure the footer shows, and what to call it — the same money, read from two sides. */
export interface EventMoneyView {
	label: string;
	/** The server-computed figure. The ONE money shape on the platform, rendered verbatim. */
	value: MoneyView;
	/** A supporting line — what the figure covers. `null` when the label says it all. */
	note: string | null;
}

/**
 * The money the acting seat cares about.
 *
 * A provider reads what the occurrence EARNS them; a buyer reads what a seat COSTS. Both figures were
 * computed on the server and arrive as `MoneyView`s — the client never multiplies a seat price by a
 * head count, because a rounded per-seat figure times a count does not reliably equal the amount that
 * will actually be released, and a host reading a fabricated number is reading a promise nobody made.
 *
 * A `free` occurrence returns `null` rather than a zero: deliberately free and not-yet-priced are
 * different facts, and £0.00 states the second while meaning the first.
 */
export function eventMoney(event: CalendarEvent, access: EventAccess): EventMoneyView | null {
	const pricing = event.pricing;
	if (!pricing || pricing.model === "free") return null;

	if (access.isFreelancer) {
		if (!pricing.occurrenceEarnings) return null;
		return {
			label: "You earn",
			value: pricing.occurrenceEarnings,
			note: pricing.model === "per_seat"
				? `${pricing.paidSeats} ${pricing.paidSeats === 1 ? "seat" : "seats"} sold`
				: null,
		};
	}
	if (!pricing.unitPrice) return null;
	return {
		label: pricing.viewerHasPaid ? "Your seat" : "Seat price",
		value: pricing.unitPrice,
		note: pricing.viewerHasPaid ? "Paid" : null,
	};
}
// #endregion
