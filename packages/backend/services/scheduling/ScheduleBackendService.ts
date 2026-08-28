import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	isExploreBackendLive,
	isProfileBackendLive,
	isProjectsBackendLive,
} from "../../core/supabase.ts";
import { isReservedHandle } from "@projective/types/profile";
import type {
	AvailabilityParams,
	BookableSlot,
	CalendarEvent,
	CalendarPage,
	CalendarParams,
	EventReschedule,
	RescheduleInput,
	RescheduleMode,
	RescheduleProposal,
	RescheduleRefusalReason,
	RsvpInput,
	SchedulePage,
	ScheduleParams,
	SchedulingSim,
	SchedulingTarget,
	SchedulingViewer,
	SlotGrid,
	SlotQuery,
} from "@projective/types/scheduling";
import {
	ANONYMOUS_VIEWER,
	canOpenVote,
	canReschedule,
	eligibleVoterCount,
	eventLiveStatus,
	findSlot,
	isEventParty,
	isProposalOnBallot,
	isRescheduleClosed,
	majorityProposal,
	redactEventForViewer,
	redactEventsForViewer,
	RESCHEDULE_REFUSAL_COPY,
	rescheduleModeFor,
	settleVote,
	viewerAttendee,
	voteIsOpen,
	voteResolvesAt,
} from "@projective/types/scheduling";
import { calendarSurfaceKey, findCalendarPage } from "./calendar-fixtures.ts";
import { findPersonalCalendarPage } from "./personal-fixtures.ts";
import { availabilitySurfaceKey, findAvailabilityPage } from "./availability-fixtures.ts";
import { findSchedulePage, scheduleSurfaceKey } from "./schedule-fixtures.ts";
import { overlayKey, writeRescheduleOverlay, writeRsvpOverlay } from "./coordination-fixtures.ts";
import { buildSlotGrid, type SlotGridInput } from "./slot-fixtures.ts";
import { NOW } from "./derive.ts";

/**
 * ScheduleBackendService — the FAT server-side service behind the Calendar & Schedule surfaces: the
 * project/channel calendar, a `@handle`'s availability, and a session-based entity's schedule. It owns
 * the projection of each surface's domain data (an engagement, a profile, an explore item) into the
 * shared `@projective/types/scheduling` shapes the {@link "@projective/ui/calendar"} engine renders.
 * Thin routes under `apps/web/routes/api/scheduling/*` do only HTTP parsing + guard, then delegate here
 * and map the returned {@link ServiceResult} to a `Response`; the calendar routes call these directly
 * for SSR first paint. Islands never reach this — they `fetch` the routes via `ScheduleService`.
 *
 * **No new env gate.** Each read rides its OWN domain's existing switch (matching where the source data
 * lives): the project calendar behind {@link isProjectsBackendLive}, availability behind
 * {@link isProfileBackendLive}, an entity schedule behind {@link isExploreBackendLive}. All default off,
 * so the app answers from deterministic fixtures until the RLS-scoped `scheduling.*` reads + external-
 * calendar sync land behind the same gates with zero shape churn.
 *
 * **Every method takes a {@link SchedulingViewer}, and every response passes through the privacy
 * projection.** Two of the three reads are guest-reachable public pages, so "who is asking" is a
 * first-class argument rather than an ambient assumption, and {@link redactEventForViewer} is applied
 * at this boundary — on the way out, unconditionally, on the read AND the write paths — so a caller
 * who is not a party to an event never receives its roster, its meeting link and passcode, its
 * attendees' notes, or the host's earnings. It cannot be gated on
 * {@link CalendarEvent.masked}: masking is a presentation rule and a public group session is
 * deliberately unmasked. Every viewer defaults to {@link ANONYMOUS_VIEWER}, so forgetting to pass one
 * withholds more rather than less.
 *
 * **The writes.** {@link ScheduleBackendService.respond} and {@link ScheduleBackendService.reschedule}
 * are the domain's first mutations. They own every rule — the thin routes do HTTP + Zod + guard and
 * nothing else — and each rule is applied by calling the SSOT's own pure predicate
 * ({@link canReschedule}, {@link canOpenVote}, {@link isProposalOnBallot}, {@link voteIsOpen},
 * {@link majorityProposal}, {@link settleVote}), never by re-deriving it here. There is therefore
 * exactly one implementation of each, and it is the one the unit tests in
 * `packages/types/scheduling/coordination_test.ts` pin.
 */

// #region Write helpers
/** An event located on the page that derived it, plus the store key its writes belong to. */
interface ResolvedTarget {
	key: string;
	event: CalendarEvent;
}

/**
 * Re-resolve an event through the same reader that drew the page it came from.
 *
 * A calendar event id is unique only WITHIN its page (`sync-{stageId}`, `av-0`), so a write carries
 * its scope and the server looks the event up rather than trusting a bare id — and every rule below
 * is then evaluated against the event's own start time, which is the only honest source for it.
 *
 * The viewer is threaded in because the reader is what SEATS them: without it the returned event
 * would carry no acting seat and every write would refuse.
 */
function resolveTarget(target: SchedulingTarget, viewer: SchedulingViewer): ResolvedTarget | null {
	let surfaceKey: string | null = null;
	let events: readonly CalendarEvent[] = [];
	/**
	 * The id the OWNING surface knows the event by, which is not always the id the caller sent.
	 *
	 * The personal agenda re-keys every borrowed entry by its engagement, so five projects' `task-0`
	 * do not collapse into one — but the coordination store is keyed on the engagement, because an
	 * RSVP made from `/calendar` and the same RSVP made from `/projects/{slug}/calendar` must be one
	 * answer to one question rather than two. The event is therefore FOUND by the id the caller sent
	 * and STORED under the id its engagement uses.
	 */
	let overlayId = target.eventId;
	// The write carries the overlay the SURFACE was reading under, so the re-resolve reproduces the
	// event the caller was actually looking at. Without it a simulated seat votes against an event the
	// server re-derives with nobody on it, and every action refuses for an invisible reason.
	const sim = target.sim;

	switch (target.scope) {
		case "project":
		case "channel": {
			if (!target.projectId) return null;
			surfaceKey = calendarSurfaceKey(target.projectId);
			events = findCalendarPage(
				{
					projectId: target.projectId,
					channelId: target.channelId ?? null,
				},
				viewer,
				sim,
			)?.events ?? [];
			break;
		}
		case "availability": {
			if (!target.handle || isReservedHandle(target.handle)) return null;
			surfaceKey = availabilitySurfaceKey(target.handle);
			events = findAvailabilityPage(target.handle, viewer, sim)?.events ?? [];
			break;
		}
		case "schedule": {
			if (!target.entityId) return null;
			surfaceKey = scheduleSurfaceKey(target.entityId);
			events = findSchedulePage(target.entityId, viewer, sim)?.events ?? [];
			break;
		}
		case "personal": {
			/*
			 * The personal agenda OWNS nothing. Every entry on it is borrowed from the engagement that
			 * derived it, so the write is routed back to that engagement's own store.
			 *
			 * A block with no engagement in front of it (a private one mirrored in from a connected
			 * calendar) resolves to nothing, which is correct: it is not ours to negotiate.
			 */
			const split = target.eventId.indexOf(":");
			if (split <= 0) return null;
			surfaceKey = calendarSurfaceKey(target.eventId.slice(0, split));
			overlayId = target.eventId.slice(split + 1);
			// Read back through the PERSONAL page, so the refreshed event carries the id and the
			// engagement strapline the grid is drawing it with — a re-read through the project page
			// would hand the surface an event it cannot match to any block it is showing.
			events = findPersonalCalendarPage(viewer, sim).events;
			break;
		}
	}

	if (!surfaceKey) return null;
	const event = events.find((e) => e.id === target.eventId);
	return event ? { key: overlayKey(surfaceKey, overlayId), event } : null;
}

/** A refusal carrying its machine-readable code, so a surface explains it without re-deriving it. */
function refuse<T>(status: number, reason: RescheduleRefusalReason): ServiceResult<T> {
	return fail<T>(status, { message: RESCHEDULE_REFUSAL_COPY[reason], errors: { reason } });
}

/** The empty negotiation a first action starts from. */
function emptyReschedule(mode: RescheduleMode): EventReschedule {
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

/**
 * The single privacy choke point every page read passes through. Generic over the two page envelopes
 * because they differ in everything except the field that matters here.
 */
function projectPage<T extends { events: CalendarEvent[] }>(page: T, viewer: SchedulingViewer): T {
	return { ...page, events: redactEventsForViewer(page.events, viewer) };
}
// #endregion

export class ScheduleBackendService {
	/**
	 * The project-level (`/projects/[id]/calendar`) or channel-level (`/projects/[id]/[channel]/calendar`)
	 * calendar: task deadlines, review milestones, scheduled stage syncs, and — for session engagements —
	 * recurring group sessions, derived from the engagement. `404` for an unresolved project.
	 */
	static projectCalendar(
		params: CalendarParams,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		sim?: SchedulingSim,
	): ServiceResult<{ page: CalendarPage }> {
		if (!isProjectsBackendLive()) {
			const page = findCalendarPage(params, viewer, sim);
			if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
			return ok({ page: projectPage(page, viewer) });
		}
		// LIVE: read the RLS-scoped `scheduling.*` + `projects.*` graph and sync connected external
		// calendars (not yet implemented) — fall back to the fixture projection so behaviour is preserved.
		const page = findCalendarPage(params, viewer, sim);
		if (!page) return fail(404, { message: `No project found for id "${params.projectId}".` });
		return ok({ page: projectPage(page, viewer) });
	}

	/**
	 * The acting account's OWN agenda (`/calendar`): every engagement they are on, their working hours
	 * and call windows, their booked leave, and the private blocks their connected calendars
	 * contribute.
	 *
	 * Rides {@link isProjectsBackendLive} rather than declaring a gate of its own, because that is
	 * where the source data lives — this page is the union of the project calendars, not a new corpus.
	 *
	 * There is no 404 branch: a signed-in account always HAS a calendar, and an empty week is an empty
	 * week rather than a missing resource.
	 */
	static personalCalendar(
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		sim?: SchedulingSim,
	): ServiceResult<{ page: SchedulePage }> {
		// LIVE and stub resolve identically for now: the RLS-scoped `scheduling.*` read and the
		// external-calendar sync are not implemented, so behaviour is preserved either side of the gate.
		const page = findPersonalCalendarPage(viewer, sim);
		return ok({ page: projectPage(page, viewer) });
	}

	/**
	 * A `@handle`'s public availability schedule (`/[handle]/availability`): weekly working hours,
	 * timezone, blackout dates, and privacy-masked bookable/busy blocks (plus any public group sessions).
	 * `404` for a reserved or unresolved handle.
	 */
	static availability(
		params: AvailabilityParams,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		sim?: SchedulingSim,
	): ServiceResult<{ page: SchedulePage }> {
		if (isReservedHandle(params.handle)) {
			return fail(404, { message: `"${params.handle}" is a reserved route, not a profile.` });
		}
		if (!isProfileBackendLive()) {
			const page = findAvailabilityPage(params.handle, viewer, sim);
			if (!page) return fail(404, { message: `No profile found for "${params.handle}".` });
			return ok({ page: projectPage(page, viewer) });
		}
		// LIVE: read the RLS-scoped `scheduling.*` availability tables (not yet implemented) — fall back to
		// the fixture projection so behaviour is preserved until that path lands.
		const page = findAvailabilityPage(params.handle, viewer, sim);
		if (!page) return fail(404, { message: `No profile found for "${params.handle}".` });
		return ok({ page: projectPage(page, viewer) });
	}

	/**
	 * A session-based entity's public schedule (`/view/[entity]/schedule`): the recurring class/session
	 * slots + attendee counts + bookable 1:1 windows for the viewed explore item. `404` for an unresolved
	 * entity.
	 */
	static entitySchedule(
		params: ScheduleParams,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		sim?: SchedulingSim,
	): ServiceResult<{ page: SchedulePage }> {
		if (!isExploreBackendLive()) {
			const page = findSchedulePage(params.entityId, viewer, sim);
			if (!page) return fail(404, { message: `No item found for id "${params.entityId}".` });
			return ok({ page: projectPage(page, viewer) });
		}
		// LIVE: read the RLS-scoped `scheduling.*` + discovery graph (not yet implemented) — fall back to
		// the fixture projection so behaviour is preserved until that path lands.
		const page = findSchedulePage(params.entityId, viewer, sim);
		if (!page) return fail(404, { message: `No item found for id "${params.entityId}".` });
		return ok({ page: projectPage(page, viewer) });
	}

	/**
	 * Record the viewer's own RSVP and answer with the refreshed event.
	 *
	 * A viewer may only ever answer for themselves: the acting seat is the roster row the server
	 * itself marked `isViewer`, never an id the caller supplies, so there is no payload shape that
	 * could change somebody else's answer. Answering a finished event is refused rather than silently
	 * accepted — an RSVP is a statement about attending, and it cannot be made in the past tense.
	 *
	 * `pending` is accepted, not rejected: clearing an answer back to "no answer yet" is a real thing
	 * a person does, and it is a different fact from saying Maybe. The overlay clears `respondedAt`
	 * with it, honouring the schema's "null while pending" invariant.
	 */
	static respond(
		input: RsvpInput,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	): ServiceResult<{ event: CalendarEvent }> {
		const found = resolveTarget(input, viewer);
		if (!found) return fail(404, { message: "That event is no longer on this schedule." });

		const me = viewerAttendee(found.event.roster ?? []);
		if (!me) return refuse(403, "not_permitted");
		if (eventLiveStatus(NOW, found.event.start, found.event.end).state === "passed") {
			return refuse(409, "event_passed");
		}

		writeRsvpOverlay(found.key, input.response, input.note ?? null);
		const after = resolveTarget(input, viewer);
		return after
			? ok({ event: redactEventForViewer(after.event, viewer) })
			: fail(500, { message: "The response was recorded but the event could not be re-read." });
	}

	/**
	 * Apply one move to an event's reschedule negotiation and answer with the refreshed event.
	 *
	 * Every refusal is a {@link RescheduleRefusalReason} with its copy attached, because a surface
	 * that has to guess why a control refused will guess differently from the server sooner or later.
	 *
	 * The negotiation MODE is a property of the event, not a choice the opener makes: an arrangement
	 * with more than two people on it is settled by a vote, a 1-on-1 by the counterparty confirming.
	 * Offering that as a switch would let a host put a two-person meeting to a "vote" of one.
	 *
	 * **A round always has a way out.** `resolved`, `lapsed` and `withdrawn` all close the current
	 * round to every action except `propose`, and `propose` on a closed round opens the NEXT one with
	 * a fresh ballot. That is what makes withdrawing recoverable: previously it set a status that the
	 * closed-round guard then blocked `open` from ever leaving, while still admitting `propose` — so
	 * a host who withdrew once accumulated slots forever with no way to put any of them to anybody.
	 */
	static reschedule(
		input: RescheduleInput,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	): ServiceResult<{ event: CalendarEvent }> {
		const found = resolveTarget(input, viewer);
		if (!found) return fail(404, { message: "That event is no longer on this schedule." });
		const event = found.event;

		if (eventLiveStatus(NOW, event.start, event.end).state === "passed") {
			return refuse(409, "event_passed");
		}
		// Rule 1 — nothing moves inside the lockout, whoever is asking.
		if (!canReschedule(NOW, event.start)) return refuse(409, "inside_lockout");

		// Only a party to the event may touch its negotiation, and being a party is the server's own
		// seating rather than anything the caller asserted (see `./privacy.ts`).
		if (!isEventParty(event, viewer)) return refuse(403, "not_permitted");
		const isHost = event.viewerIsHost === true;
		const roster = event.roster ?? [];
		const me = viewerAttendee(roster);
		const voters = eligibleVoterCount(roster);

		// Settle before acting, so no action is ever evaluated against a vote whose question has
		// already finished being asked. Idempotent, and the same call the read path makes.
		const base = settleVote(
			NOW,
			event.reschedule ?? emptyReschedule(rescheduleModeFor(roster.length)),
			voters,
		);
		const closed = isRescheduleClosed(base.status);
		if (closed && input.action !== "propose") return refuse(409, "vote_closed");

		const actor = isHost
			? event.organiser ?? { name: "Host", avatar: null, handle: null }
			: { name: me!.name, avatar: me!.avatar, handle: me!.handle };
		let next: EventReschedule;

		switch (input.action) {
			case "propose": {
				if (input.start === undefined || input.end === undefined || input.end <= input.start) {
					return fail(422, {
						message: "Give the alternative time a start and an end.",
						errors: { start: "An alternative slot needs a start and a later end." },
					});
				}
				// Rule 1 applies to the slot being OFFERED, not only to the event being moved. Without
				// this a host could put a time three hours away on the ballot: the vote's own deadline
				// (12 hours before the earliest slot) would already be in the past, so the negotiation
				// opened closed, and the ballot could elect a time that is itself already unmovable.
				if (!canReschedule(NOW, input.start)) return refuse(422, "proposal_inside_lockout");

				// A closed round is not extended, it is succeeded: proposing again is how a host asks a
				// second time after a withdrawal, a lapse, or a move that has already happened.
				const round = closed ? base.round + 1 : base.round;
				const carried = closed ? { ...emptyReschedule(base.mode), round } : base;

				const proposal: RescheduleProposal = {
					// The round is in the id because a fresh ballot restarts the index, and two proposals
					// sharing an id would make `approve`/`vote`/`confirm` address the wrong slot.
					id: `${event.id}-r${round}p${carried.proposals.length}`,
					start: input.start,
					end: input.end,
					proposedBy: actor,
					proposedByRole: isHost ? "host" : "attendee",
					proposedAt: NOW,
					// Rule 3 — a host's own slot is on the ballot immediately; an attendee's waits for
					// approval, so `approved` is exactly "was this offered by the person delivering it".
					approved: isHost,
					note: input.note ?? null,
					votes: [],
				};
				const proposals = [...carried.proposals, proposal];
				next = {
					...carried,
					proposals,
					status: carried.status === "none" ? "collecting" : carried.status,
					openedBy: carried.openedBy ?? actor,
					openedAt: carried.openedAt ?? NOW,
					// A new slot on a live ballot can bring the earliest option forward, which moves the
					// deadline with it — the deadline is a function of the ballot, not a stored decision.
					resolvesAt: carried.status === "voting" ? voteResolvesAt(proposals) : carried.resolvesAt,
				};
				break;
			}

			case "approve": {
				if (!isHost) return refuse(403, "not_permitted");
				const target = base.proposals.find((p) => p.id === input.proposalId);
				if (!target) return refuse(404, "unknown_proposal");
				const proposals = base.proposals.map((p) =>
					p.id === target.id ? { ...p, approved: true } : p
				);
				next = {
					...base,
					proposals,
					resolvesAt: base.status === "voting" ? voteResolvesAt(proposals) : base.resolvesAt,
				};
				break;
			}

			case "open": {
				if (!isHost) return refuse(403, "not_permitted");
				// Rule 2 — a vote needs at least two slots on the ballot. A 1-on-1 does not: sending one
				// time to one person is a proposal, not a ballot, so the minimum would be meaningless.
				if (base.mode === "vote" ? !canOpenVote(base.proposals) : base.proposals.length === 0) {
					return refuse(422, "not_enough_proposals");
				}
				// A ballot whose deadline has already gone is a question nobody can answer. Refusing to
				// open one is the second half of the slot validation above: that keeps a bad slot off the
				// ballot, this keeps a ballot that is somehow still unanswerable from being sent out.
				if (base.mode === "vote" && !voteIsOpen(NOW, base.proposals)) {
					return refuse(409, "vote_closed");
				}
				next = base.mode === "vote"
					? {
						...base,
						status: "voting",
						// Rule 4 — stamped once, from the ballot, so SSR and the island read one deadline.
						resolvesAt: voteResolvesAt(base.proposals),
						openedBy: base.openedBy ?? actor,
						openedAt: base.openedAt ?? NOW,
					}
					: {
						...base,
						status: "awaiting_counterparty",
						resolvesAt: null,
						openedBy: base.openedBy ?? actor,
						openedAt: base.openedAt ?? NOW,
					};
				break;
			}

			case "vote": {
				// The host authored the options; letting them vote too would be casting a ballot in
				// their own election.
				if (base.mode !== "vote" || base.status !== "voting") return refuse(409, "vote_closed");
				if (isHost || !me) return refuse(403, "not_permitted");
				const target = base.proposals.find((p) => p.id === input.proposalId);
				if (!target) return refuse(404, "unknown_proposal");
				if (!isProposalOnBallot(target)) return refuse(409, "proposal_not_approved");
				if (!voteIsOpen(NOW, base.proposals)) return refuse(409, "vote_closed");
				if (base.proposals.some((p) => p.votes.some((v) => v.attendeeId === me.id))) {
					return refuse(409, "duplicate_vote");
				}
				const proposals = base.proposals.map((p) =>
					p.id === target.id
						? {
							...p,
							votes: [...p.votes, { ...actor, attendeeId: me.id, at: NOW }],
						}
						: p
				);
				// The last eligible ballot settles the question there and then — see `settleVote`.
				next = settleVote(NOW, { ...base, proposals }, voters);
				break;
			}

			case "confirm": {
				if (base.mode === "counterparty") {
					// The party who did NOT offer the time is the one who accepts it.
					if (isHost) return refuse(403, "not_permitted");
					const target = base.proposals.find((p) => p.id === input.proposalId);
					if (!target) return refuse(404, "unknown_proposal");
					if (!isProposalOnBallot(target)) return refuse(409, "proposal_not_approved");
					next = { ...base, status: "resolved", resolvedProposalId: target.id };
					break;
				}
				// On a vote it is the HOST who finalises, and only once a slot has actually carried:
				// PRODUCT_SPEC.md §The Proactive Calendar requires a MAJORITY, so this closes a decided
				// vote early rather than deciding it. Without this the vote path had no terminal
				// transition at all — `resolved` was unreachable and the only exit was to withdraw.
				if (!isHost) return refuse(403, "not_permitted");
				if (base.status !== "voting") return refuse(409, "vote_closed");
				const winner = majorityProposal(base.proposals, voters);
				if (!winner) return refuse(409, "no_majority");
				// Naming a different slot is refused rather than ignored: a host confirming what they
				// asked for and getting something else is worse than being told no.
				if (input.proposalId && input.proposalId !== winner.id) return refuse(409, "no_majority");
				next = { ...base, status: "resolved", resolvedProposalId: winner.id };
				break;
			}

			case "withdraw": {
				if (!isHost) return refuse(403, "not_permitted");
				next = { ...base, status: "withdrawn", resolvesAt: null };
				break;
			}
		}

		writeRescheduleOverlay(found.key, next);
		const after = resolveTarget(input, viewer);
		return after
			? ok({ event: redactEventForViewer(after.event, viewer) })
			: fail(500, { message: "The change was recorded but the event could not be re-read." });
	}

	/**
	 * The **bookable slot grid** behind a session listing's Book modal and the discovery-call
	 * handshake: a window of days in the VIEWER's zone, and the offerable start times inside each.
	 *
	 * It is derived from the very same {@link SchedulePage} the public schedule surface renders, so a
	 * buyer who reads a free hour on the listing's calendar is offered that hour in the picker. Two
	 * derivations of one provider's availability is precisely how those two views come to disagree,
	 * and the disagreement is invisible until somebody books.
	 *
	 * **The grid discloses no more than the public schedule already does.** It reports that a time is
	 * free or spoken for, never who has it — the `masked` projection of §Part 1.4 — so it is safe on a
	 * guest-reachable listing page. Cohort occurrences report a seat COUNT, which is the one figure a
	 * public group session may show precisely because it names nobody.
	 *
	 * `handle` grids ride {@link isProfileBackendLive} (the availability corpus); listing grids ride
	 * {@link isExploreBackendLive}. Neither is a new gate: this read is a projection of data those two
	 * already own.
	 */
	static slots(
		query: SlotQuery,
		input: Omit<SlotGridInput, "page" | "purpose" | "subjectId">,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		sim?: SchedulingSim,
	): ServiceResult<{ grid: SlotGrid }> {
		const page = query.purpose === "discovery_call"
			? findAvailabilityPage(query.subjectId, viewer, sim)
			: findSchedulePage(query.subjectId, viewer, sim);
		if (!page) {
			return fail(404, {
				message: query.purpose === "discovery_call"
					? `No profile found for "${query.subjectId}".`
					: `No item found for id "${query.subjectId}".`,
			});
		}
		return ok({
			grid: buildSlotGrid(query, {
				...input,
				page,
				purpose: query.purpose,
				subjectId: query.subjectId,
			}),
		});
	}

	/**
	 * Re-resolve one slot through the same reader the grid was drawn from, and answer whether it can
	 * still be taken.
	 *
	 * Every write path calls this rather than trusting the instants a caller sends. That is the
	 * {@link SchedulingTarget} rule applied to bookings, and it is load-bearing for the same reason: a
	 * caller who supplies their own start time can address a slot outside the provider's call windows,
	 * inside their blackout, or one somebody else already holds — none of which the reader would ever
	 * have offered them.
	 */
	static resolveSlot(
		query: SlotQuery,
		input: Omit<SlotGridInput, "page" | "purpose" | "subjectId">,
		slotId: string,
		viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	): ServiceResult<{ slot: BookableSlot; grid: SlotGrid }> {
		const read = ScheduleBackendService.slots(query, input, viewer);
		if (!read.ok || !read.data) return fail(read.status, { message: read.message });
		const grid = read.data.grid;
		const slot = findSlot(grid, slotId);
		if (!slot) {
			return fail(409, {
				message: "That time is no longer on this schedule. Pick another slot.",
				errors: { slotId: "slot_unavailable" },
			});
		}
		if (!slot.available) {
			return fail(409, {
				message: SLOT_REFUSAL_COPY[slot.reason ?? "slot_unavailable"] ??
					"That time is no longer available.",
				errors: { slotId: slot.reason ?? "slot_unavailable" },
			});
		}
		return ok({ slot, grid });
	}
}

/**
 * The sentence a refused slot is explained with.
 *
 * Server-authored so the copy has ONE home: the picker's pre-flight check and the write's refusal
 * must say the same thing, or a buyer is told two different reasons for one failure depending on how
 * fast they clicked. Falls through to a neutral sentence for a reason this map has not been taught,
 * which is a missing string rather than a missing explanation.
 */
const SLOT_REFUSAL_COPY: Partial<Record<string, string>> = {
	taken: "Someone booked that time first. Pick another slot.",
	past: "That time has already passed.",
	blackout: "The provider is away then.",
	slot_unavailable: "That time is no longer available.",
	inside_minimum_notice: "That is too soon — this provider needs more notice.",
	beyond_booking_horizon: "That is further ahead than this provider's calendar is open.",
	outside_call_window: "The provider does not take bookings at that time.",
	weekly_courtesy_cap_reached: "This provider has no free calls left this week.",
	requester_in_cooldown: "You have had a free call with this provider recently. Try again later.",
};
