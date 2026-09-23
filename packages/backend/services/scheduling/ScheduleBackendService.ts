import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isReservedHandle } from "@projective/types/profile";
import type {
	AvailabilityParams,
	BookableSlot,
	CalendarEvent,
	CalendarPage,
	CalendarParams,
	RescheduleInput,
	RsvpInput,
	SchedulePage,
	ScheduleParams,
	SchedulingViewer,
	SlotGrid,
	SlotQuery,
} from "@projective/types/scheduling";
import {
	ANONYMOUS_VIEWER,
	findSlot,
	redactEventForViewer,
	redactEventsForViewer,
	RESCHEDULE_REFUSAL_COPY,
} from "@projective/types/scheduling";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { buildGrid, type GridRequest, judgeCustomStart } from "./slot-grid.ts";
import { type BandKind, readGridSource, type ScheduleOwner } from "./live-slots.ts";
import { readSchedulePage } from "./live-schedule-page.ts";
import { readCalendarEvent, readPersonalCalendar, readProjectCalendar } from "./live-calendar.ts";
import { type PlanRefusal, planReschedule, planRsvp } from "./coordination-plan.ts";
import { writeReschedule, writeRsvp } from "./live-coordination-writes.ts";
import { type Catalog, loadCatalog } from "../explore/live-catalog.ts";
import { getAnonClient } from "../../core/supabase.ts";

/**
 * ScheduleBackendService — the FAT server-side service behind the Calendar & Schedule surfaces: an
 * engagement's calendar, the acting account's own agenda, a `@handle`'s availability, a session
 * listing's schedule, and the bookable slot grids. Thin routes under `apps/web/routes/api/scheduling/*`
 * do only HTTP parsing + guard, then delegate here and map the returned {@link ServiceResult} to a
 * `Response`; the calendar routes call these directly for SSR first paint. Islands never reach this —
 * they `fetch` the routes via `ScheduleService`.
 *
 * **Two footings, both live.** The PUBLIC reads — a profile's availability, a session listing's
 * schedule, every bookable slot grid — read the published `scheduling.*` tables through the anonymous
 * client (`live-schedule-page.ts`, `live-slots.ts`): what they disclose is world-readable by policy,
 * so a guest and a member are answered identically. The PRIVATE reads — an engagement's calendar and
 * the personal agenda — and the coordination writes run as the signed-in reader (`live-calendar.ts`),
 * with RLS deciding which events, rosters and negotiations exist for them.
 *
 * **Every private response passes through the privacy projection.** Being able to READ an event row
 * (any member of an engagement can) is not the same as being one of its parties, so
 * {@link redactEventForViewer} is applied at this boundary, on the way out, on the read AND the write
 * paths: a member who is not on a meeting's roster receives its time and title and not its room, its
 * roster, its negotiation or its log. The seating it reads is by identity (`live-calendar.ts`).
 *
 * **The writes.** {@link ScheduleBackendService.respond} and {@link ScheduleBackendService.reschedule}
 * re-read the event exactly as its surface drew it (settled), ask the pure planner
 * (`coordination-plan.ts`) whether the move is allowed — every rule is the SSOT's own predicate — and
 * only then persist it through the service role (`live-coordination-writes.ts`), because the
 * coordination tables deliberately carry no client write policy. The answer is the event re-read
 * after the write, projected for the reader.
 */

// #region Helpers
/** The privacy projection's view of a reader: a party is decided by the seating, not by a handle. */
function viewerOf(actor: ReadActor): SchedulingViewer {
	return { authenticated: canReadLive(actor), handle: null };
}

/** A planner or writer refusal as a service result, carrying its machine-readable reason. */
function refusal<T>(r: PlanRefusal): ServiceResult<T> {
	const errors: Record<string, string> = { ...(r.errors ?? {}) };
	if (r.reason) errors.reason = r.reason;
	return fail<T>(r.status, {
		message: r.message ??
			(r.reason ? RESCHEDULE_REFUSAL_COPY[r.reason] : "That change could not be made."),
		errors: Object.keys(errors).length > 0 ? errors : undefined,
	});
}

function signInRequired<T>(what: string): ServiceResult<T> {
	return fail<T>(401, { message: `Sign in to ${what}.` });
}

function calendarUnavailable<T>(err: unknown): ServiceResult<T> {
	console.error("scheduling: calendar read failed", err);
	return fail<T>(503, { message: "The calendar could not be read. Please try again." });
}

/**
 * The privacy choke point every private page read passes through. Generic over the two page
 * envelopes because they differ in everything except the field that matters here.
 */
function projectPage<T extends { events: CalendarEvent[] }>(page: T, viewer: SchedulingViewer): T {
	return { ...page, events: redactEventsForViewer(page.events, viewer) };
}
// #endregion

export class ScheduleBackendService {
	/**
	 * The project-level (`/projects/[slug]/calendar`) or channel-level
	 * (`/projects/[slug]/[channel]/calendar`) calendar: the engagement's meetings, its stage due dates
	 * and the due dates of the tickets the reader can see on its board. `404` for a project (or a room)
	 * the reader may not see; `401` without a session.
	 */
	static async projectCalendar(
		params: CalendarParams,
		actor: ReadActor,
		now: number = Date.now(),
	): Promise<ServiceResult<{ page: CalendarPage }>> {
		if (!canReadLive(actor)) return signInRequired("view this calendar");
		let page: CalendarPage | null;
		try {
			page = await readProjectCalendar(actor, params, now);
		} catch (err) {
			return calendarUnavailable(err);
		}
		if (!page) return fail(404, { message: `No project found for "${params.projectId}".` });
		return ok({ page: projectPage(page, viewerOf(actor)) });
	}

	/**
	 * The acting account's OWN agenda (`/calendar`): their working hours, call windows and leave, the
	 * entries on their own schedule, the meetings they are on, their calls, and the due dates of the
	 * work they are on. There is no 404: a signed-in account always has a calendar, and an empty week
	 * is an empty week rather than a missing resource.
	 */
	static async personalCalendar(
		actor: ReadActor,
		now: number = Date.now(),
	): Promise<ServiceResult<{ page: SchedulePage }>> {
		if (!canReadLive(actor)) return signInRequired("view your calendar");
		try {
			const page = await readPersonalCalendar(actor, now);
			return ok({ page: projectPage(page, viewerOf(actor)) });
		} catch (err) {
			return calendarUnavailable(err);
		}
	}

	/**
	 * A `@handle`'s public availability (`/[handle]/availability`): their published working hours and
	 * call windows, their time off, and masked busy blocks — read live from `scheduling.*`
	 * (`live-schedule-page.ts`). `404` for a reserved or unknown handle, and for a profile that has
	 * published no schedule (there is nothing to show, and "no availability" would be a claim).
	 */
	static async availability(
		params: AvailabilityParams,
		_viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		now: number = Date.now(),
	): Promise<ServiceResult<{ page: SchedulePage }>> {
		if (isReservedHandle(params.handle)) {
			return fail(404, { message: `"${params.handle}" is a reserved route, not a profile.` });
		}
		const handle = params.handle.replace(/^@+/, "");
		const owner = await profileOwnerOf(handle);
		if (owner === undefined) return scheduleUnavailable();
		if (!owner) return fail(404, { message: `No profile found for "${params.handle}".` });
		const page = await readSchedulePage(owner, {
			scope: "availability",
			title: "Availability",
			subtitle: null,
			ownerHandle: `@${handle}`,
			viewerCanBook: false,
			now,
		}, pageWindow(now));
		if (page === undefined) return scheduleUnavailable();
		if (!page) return fail(404, { message: `@${handle} has not published their availability.` });
		// A slot opens a booking only where there is something to book: a discovery call.
		return ok({ page: { ...page, viewerCanBook: page.callOffer !== undefined } });
	}

	/**
	 * A session listing's public schedule (`/view/[entity]/schedule` and the listing page's scheduler
	 * stage): the provider's published working hours, time off and masked busy blocks. `404` for an
	 * unknown listing, or one whose provider has published no schedule.
	 */
	static async entitySchedule(
		params: ScheduleParams,
		_viewer: SchedulingViewer = ANONYMOUS_VIEWER,
		now: number = Date.now(),
	): Promise<ServiceResult<{ page: SchedulePage }>> {
		const catalog = await loadCatalog().catch(() => null);
		if (!catalog) return scheduleUnavailable();
		const item = catalog.byId.get(params.entityId);
		const owner = item ? listingScheduleOwner(catalog, item.id) : null;
		if (!item || !owner) {
			return fail(404, { message: `No item found for id "${params.entityId}".` });
		}
		const page = await readSchedulePage(owner, {
			scope: "schedule",
			title: item.title,
			subtitle: `With ${item.owner.name}`,
			ownerHandle: item.owner.handle,
			viewerCanBook: true,
			now,
		}, pageWindow(now));
		if (page === undefined) return scheduleUnavailable();
		if (!page) {
			return fail(404, {
				message: `${item.owner.name} has not published a schedule for this listing.`,
			});
		}
		return ok({ page });
	}

	/**
	 * Record the reader's own RSVP and answer with the refreshed event.
	 *
	 * A reader only ever answers for themselves: the seat is the roster row the reader was seated on
	 * BY IDENTITY, never an id the caller supplies, so there is no payload shape that could change
	 * somebody else's answer. Answering a finished event is refused — an RSVP is a statement about
	 * attending, and it cannot be made in the past tense.
	 */
	static async respond(
		input: RsvpInput,
		actor: ReadActor,
		now: number = Date.now(),
	): Promise<ServiceResult<{ event: CalendarEvent }>> {
		if (!canReadLive(actor)) return signInRequired("respond");
		try {
			const loaded = await readCalendarEvent(actor, input, now);
			if (!loaded) return fail(404, { message: "That event is no longer on this schedule." });
			const plan = planRsvp(loaded.event, input, now);
			if (!plan.ok) return refusal(plan);
			const refused = await writeRsvp(actor, loaded, plan.seat, input, now);
			if (refused) return refusal(refused);
			const after = await readCalendarEvent(actor, input, now);
			return after
				? ok({ event: redactEventForViewer(after.event, viewerOf(actor)) })
				: fail(500, { message: "The response was recorded but the event could not be re-read." });
		} catch (err) {
			return calendarUnavailable(err);
		}
	}

	/**
	 * Apply one move to an event's reschedule negotiation and answer with the refreshed event.
	 *
	 * Every refusal is a `RescheduleRefusalReason` with its copy attached, because a surface that has
	 * to guess why a control refused will guess differently from the server sooner or later. The rules
	 * are the planner's (`coordination-plan.ts`); this method sequences the re-read, the plan, the write
	 * and the second re-read, and decides nothing itself.
	 */
	static async reschedule(
		input: RescheduleInput,
		actor: ReadActor,
		now: number = Date.now(),
	): Promise<ServiceResult<{ event: CalendarEvent }>> {
		if (!canReadLive(actor)) return signInRequired("reschedule");
		try {
			const loaded = await readCalendarEvent(actor, input, now);
			if (!loaded) return fail(404, { message: "That event is no longer on this schedule." });
			const plan = planReschedule(loaded.event, input, now, viewerOf(actor));
			if (!plan.ok) return refusal(plan);
			const refused = await writeReschedule(actor, loaded, plan, now);
			if (refused) return refusal(refused);
			const after = await readCalendarEvent(actor, input, now);
			return after
				? ok({ event: redactEventForViewer(after.event, viewerOf(actor)) })
				: fail(500, { message: "The change was recorded but the event could not be re-read." });
		} catch (err) {
			return calendarUnavailable(err);
		}
	}

	/**
	 * The **bookable slot grid** behind a session listing's Book modal and the discovery-call
	 * handshake: a window of days in the VIEWER's zone, and the offerable start times inside each.
	 *
	 * Built from the provider's PUBLISHED schedule — its bands of the given kind, its blackouts, its
	 * booking guards and its busy time (`live-slots.ts`) — by the pure builder in `slot-grid.ts`, which
	 * applies the same four rules the database's booking gate does. So a slot this grid offers is a slot
	 * the write accepts, and the grid a guest sees is the grid a member sees.
	 *
	 * **The grid discloses no more than the public schedule already does.** It reports that a time is
	 * free or spoken for, never who has it; busy time arrives as bare spans.
	 */
	static async slots(
		query: SlotQuery,
		input: SlotGridRequest,
		target: SlotTarget,
		now: number = Date.now(),
	): Promise<ServiceResult<{ grid: SlotGrid }>> {
		const source = await readGridSource(target.owner, target.kind, gridWindow(query, now));
		if (!source) return scheduleUnavailable();
		return ok({ grid: buildGrid(query, source, gridRequest(query, input, now)) });
	}

	/**
	 * Re-resolve one slot through the same reader the grid was drawn from, and answer whether it can
	 * still be taken.
	 *
	 * Every write path calls this rather than trusting the instants a caller sends: a caller who
	 * supplies their own start time can otherwise address a slot outside the provider's bands, inside
	 * their blackout, or one somebody else already holds — none of which the reader would ever offer.
	 */
	static async resolveSlot(
		query: SlotQuery,
		input: SlotGridRequest,
		target: SlotTarget,
		slotId: string,
		now: number = Date.now(),
	): Promise<ServiceResult<{ slot: BookableSlot; grid: SlotGrid }>> {
		const read = await ScheduleBackendService.slots(query, input, target, now);
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

	/**
	 * Resolve a CUSTOM start — a time the grid's cadence did not land on — through the same reader,
	 * and answer the slot it would occupy or why it cannot. The refusal is field-keyed to `startsAt`,
	 * so a modal pins it to the time control the buyer typed into.
	 */
	static async resolveCustomStart(
		query: SlotQuery,
		input: SlotGridRequest,
		target: SlotTarget,
		startsAt: number,
		now: number = Date.now(),
	): Promise<ServiceResult<{ slot: BookableSlot }>> {
		const source = await readGridSource(target.owner, target.kind, gridWindow(query, now));
		if (!source) return scheduleUnavailable();
		const resolved = judgeCustomStart(query, source, gridRequest(query, input, now), startsAt);
		if ("reason" in resolved) {
			return fail(409, {
				message: SLOT_REFUSAL_COPY[resolved.reason] ?? "That time is not available.",
				errors: { startsAt: resolved.reason },
			});
		}
		return ok({ slot: resolved.slot });
	}
}

// #region Slot grid plumbing
/** What a booking asks the grid for — the listing's (or the call flavour's) own parameters. */
export interface SlotGridRequest {
	/** The block size — `1` everywhere except a set-session package. */
	sessionCount: number;
	/** Each slot's length. Provider-set; never buyer-chosen. */
	durationMinutes: number;
	/** Cohort capacity per occurrence, or `null` for a one-to-one grid. */
	seatsPerSession: number | null;
}

/** Whose schedule the grid is drawn from, and which of its bands a booking lands in. */
export interface SlotTarget {
	owner: ScheduleOwner;
	kind: BandKind;
}

function gridRequest(query: SlotQuery, input: SlotGridRequest, now: number): GridRequest {
	return { ...input, purpose: query.purpose, subjectId: query.subjectId, now };
}

/**
 * The window of busy time and blackouts a grid needs: the rail plus a day of padding either side (the
 * builder walks provider-local days one wider than the viewer's rail).
 */
function gridWindow(query: SlotQuery, now: number): { from: number; to: number } {
	const DAY = 86_400_000;
	const start = Math.max(query.from ?? now, now);
	return { from: Math.min(start, now) - 2 * DAY, to: start + (query.days + 3) * DAY };
}

/** A public schedule page's window: a fortnight back (recent context) and three months ahead. */
function pageWindow(now: number): { from: number; to: number } {
	const DAY = 86_400_000;
	return { from: now - 14 * DAY, to: now + 90 * DAY };
}

/**
 * The owner a `@handle` names, through `org.get_profile_owner` (a private profile resolves to nobody).
 * `undefined` when the database could not answer.
 */
async function profileOwnerOf(handle: string): Promise<ScheduleOwner | null | undefined> {
	try {
		const { data, error } = await getAnonClient().schema("org").rpc("get_profile_owner", {
			p_handle: handle,
		});
		if (error) return undefined;
		const owner = data as { owner_type: ScheduleOwner["type"]; owner_id: string } | null;
		return owner ? { type: owner.owner_type, id: owner.owner_id } : null;
	} catch {
		return undefined;
	}
}

/** The schedule a listing books into: its team's when team-owned, else its seller's. */
function listingScheduleOwner(catalog: Catalog, itemId: string): ScheduleOwner | null {
	const blueprint = catalog.blueprintBySlug.get(itemId);
	if (blueprint) {
		return blueprint.owner_team_id
			? { type: "team", id: blueprint.owner_team_id }
			: { type: "user", id: blueprint.freelancer_profile_id };
	}
	const product = catalog.productBySlug.get(itemId);
	if (product) {
		return product.owner_team_id
			? { type: "team", id: product.owner_team_id }
			: { type: "user", id: product.owner_user_id };
	}
	return null;
}

function scheduleUnavailable<T>(): ServiceResult<T> {
	return fail(503, { message: "The provider's schedule could not be read. Please try again." });
}
// #endregion

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
