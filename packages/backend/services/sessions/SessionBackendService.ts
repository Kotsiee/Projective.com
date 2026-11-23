import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { DEFAULT_LOCALE, formatMoney } from "@projective/types/finance";
import {
	getAnonClient,
	getServiceClient,
	getUserClient,
	isProjectsBackendLive,
	isSupabaseConfigured,
	useMocks,
} from "../../core/supabase.ts";
import {
	type CohortOffer,
	DEFAULT_WAITLIST_INVITE_HOLD_HOURS,
	type PresenceEvent,
	type PresenceOutcome,
	type SeatHold,
	type SeatInviteView,
	SeatInviteViewSchema,
	type SeatLinkResult,
	seatCount,
	type SessionWorkspace,
	type ViewerSeat,
	ViewerSeatSchema,
	type ViewerWaitlistPlace,
	ViewerWaitlistPlaceSchema,
	type WaitlistPlace,
	WaitlistStatusSchema,
} from "@projective/types/projects";
import type { DisputeStatus } from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import {
	type RawCohortOffer,
	type RawWorkspace,
	toCohortOffer,
	toSessionWorkspace,
} from "./workspace-model.ts";
import { fixtureCohortOffer, fixtureWorkspace } from "./session-fixtures.ts";

/**
 * SessionBackendService — the fat service behind session and group-session engagements (Decision
 * #171): the cohort a listing seats into, seat holds, the workspace the session sidebars render, the
 * curriculum, cancellations under the late-cancel rule, no-show claims, and the presence webhook.
 *
 * It computes no money and decides no rule the database decides: every write is one of the definers in
 * `00001155_functions_projects_sessions.sql`, run as the caller (RLS and `auth.uid()` are the real
 * gates), and every read maps through `workspace-model.ts`. The only service-role call is the presence
 * webhook's, after `IntegrationsBackendService.handleWebhook` verified its provider signature.
 *
 * Live behind `PROJECTS_BACKEND_LIVE`; the fixture world (`dev:mock`) is served from
 * `session-fixtures.ts` through the same mapper.
 */

/**
 * What cancelling a seat did with its money (`projects.cancel_cohort_membership`). `partial` is a 1-1
 * block a client cancelled across the notice line (Decision #211): `refundedMinor` went back to the
 * payer, `forfeitedMinor` (net of the fee) to the provider; `amountMinor` is their sum.
 */
export interface SeatCancellation {
	outcome: "refunded" | "forfeited" | "partial";
	amountMinor: number;
	refundedMinor: number;
	forfeitedMinor: number;
	currency: string | null;
}

// #region Refusals
/** A definer's refusal (SQLSTATE + message) onto a ServiceResult. */
function refusal<T>(error: { code?: string; message?: string; details?: string | null }): ServiceResult<T> {
	const message = error.message ?? "That couldn't be done just now.";
	let details: Record<string, string | number | null> | undefined;
	try {
		const parsed = error.details ? JSON.parse(error.details) : null;
		if (parsed && typeof parsed === "object") details = parsed;
	} catch { /* a plain-text DETAIL carries nothing structured */ }
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "22023":
			return fail(422, { message });
		case "P0002":
			return fail(404, { message });
		case "PU422":
			return fail(422, { message });
		case "PS409":
		case "PC409":
			return fail(409, { message, details });
		default:
			return fail(502, { message: "That couldn't be done just now. Please try again." });
	}
}

function signedOut<T>(): ServiceResult<T> {
	return fail(401, { message: "Sign in to continue." });
}

/** A seat-link door's `Seat refused: <code>` (Decision #522) as the sentence its reader acts on. */
const SEAT_REFUSALS: Record<string, { status: number; message: string }> = {
	not_signed_in: { status: 401, message: "Sign in to continue." },
	not_found: { status: 404, message: "That seat link doesn't exist." },
	nothing_to_share: { status: 422, message: "You have no spare seat to share." },
	started: { status: 409, message: "This cohort has started, so its seats can no longer be handed on." },
	revoked: { status: 409, message: "This seat link was turned off by the person who shared it." },
	ended: { status: 409, message: "The booking behind this link has ended." },
	own: { status: 422, message: "This is your own booking." },
	seated: { status: 409, message: "You already have a seat in this cohort." },
	full: { status: 409, message: "Every shared seat on this link has been claimed." },
};

function seatRefusal<T>(error: { code?: string; message?: string; details?: string | null }): ServiceResult<T> {
	const match = /Seat refused: ([a-z_]+)/.exec(error.message ?? "");
	const known = match ? SEAT_REFUSALS[match[1]] : undefined;
	return known ? fail(known.status, { message: known.message }) : refusal(error);
}

/** `projects.get_my_cohort_seats`' answer. */
interface RawViewerSeat {
	membership_id: string;
	seats: number;
	sponsored: boolean;
	can_share: boolean;
	claimed: { name: string; handle: string; joined_at: string }[] | null;
	code: string | null;
}

/** `projects.get_cohort_seat_invite`'s answer. */
interface RawSeatInvite {
	state: string;
	seats_left: number;
	cohort_name: string;
	first_start: string | null;
	sponsor_name: string | null;
	listing_title: string | null;
	listing_slug: string | null;
	project_slug: string | null;
}

/** `projects.get_waitlist_place`'s answer, as PostgREST hands it over. */
interface RawWaitlistPlace {
	status: string;
	position: number | null;
	hold_expires_at: string | null;
	seats_open: number | null;
	invite_hold_hours: number | null;
}

/** What a no-show claim's landing status means to the person who raised it. */
function claimMessage(status: DisputeStatus): string {
	switch (status) {
		case "resolved_refund":
			return "The room's logs show the provider never joined — your payment was refunded.";
		case "resolved_release":
		case "resolved_split":
			return "The room's logs show you were both there, so the claim was dismissed.";
		case "awaiting_response":
			return "Claim filed. The provider has been asked to respond; your payment stays held.";
		default:
			return "Claim filed. Your payment stays held, and the room's logs are checked when the session ends.";
	}
}
// #endregion

export class SessionBackendService {
	/**
	 * The cohort a group-session listing seats buyers into right now, with its real occupancy, sittings
	 * and curriculum. `null` when the listing has no enrolling cohort. Public (guests read the entity
	 * view): it runs as `anon` through `get_cohort_offer`, which discloses no person and no URL.
	 *
	 * `undefined` when the database could not answer — the caller then shows no seat figure rather than
	 * an invented one.
	 */
	static async cohortOffer(
		blueprintId: string,
		fixture: { listingId: string; maxSeats: number } | null = null,
	): Promise<CohortOffer | null | undefined> {
		if (useMocks() || !isSupabaseConfigured()) {
			return fixture && fixture.maxSeats > 0
				? toCohortOffer(fixtureCohortOffer(fixture.listingId, fixture.maxSeats, Date.now()))
				: null;
		}
		try {
			const { data, error } = await getAnonClient().schema("projects").rpc("get_cohort_offer", {
				p_blueprint_id: blueprintId,
			});
			if (error) return undefined;
			return toCohortOffer(data as RawCohortOffer | null);
		} catch {
			return undefined;
		}
	}

	/**
	 * Hold `seats` seats on the listing's current cohort for the caller, for `seat_hold_minutes`
	 * (`projects.reserve_seat`, under a row lock on the cohort). Reserving again renews the caller's
	 * hold rather than stacking a second. The basket line that carries the hold to checkout is the
	 * booking composer's to add (`BookingBackendService.reserveSeat`).
	 */
	static async reserveSeat(
		blueprintId: string,
		seats: number,
		actor: ReadActor,
		cohortId?: string,
	): Promise<ServiceResult<{ hold: SeatHold; firstStartsAt: string | null }>> {
		if (!actor.accessToken) return signedOut();
		if (!isProjectsBackendLive()) {
			return fail(503, { message: "Reserving a seat needs the live database." });
		}
		const offer = await SessionBackendService.cohortOffer(blueprintId);
		if (offer === undefined) return fail(503, { message: "Seats couldn't be checked just now. Please try again." });
		if (!offer) {
			return fail(409, { message: "This listing has no cohort taking bookings yet.", details: { reason: "closed" } });
		}
		// A rolling listing's buyer may pick a later chain (SC11), only one this listing offers.
		const chain = cohortId && cohortId !== offer.cohortId
			? offer.chains.find((c) => c.cohortId === cohortId)
			: undefined;
		if (cohortId && cohortId !== offer.cohortId && !chain) {
			return fail(409, { message: "That start isn't taking bookings any more.", details: { reason: "closed" } });
		}
		const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc("reserve_seat", {
			p_cohort_id: chain?.cohortId ?? offer.cohortId,
			p_seats: seats,
		});
		if (error) return refusal(error);
		const row = data as {
			hold_id: string;
			cohort_id: string;
			seats: number;
			expires_at: string;
			max_seats: number;
			remaining: number;
		};
		return ok({
			hold: {
				holdId: row.hold_id,
				cohortId: row.cohort_id,
				seats: row.seats,
				expiresAt: new Date(row.expires_at).toISOString(),
				seatsAfter: seatCount(row.max_seats, row.max_seats - row.remaining),
			},
			firstStartsAt: chain ? chain.firstStartsAt : offer.firstStartsAt,
		}, { status: 201 });
	}

	/**
	 * Queue the caller on a group-session listing's waitlist (`projects.join_waitlist`, Decisions #424,
	 * #455), as the caller: the definer refuses a listing that is not a published group session and the
	 * seller's own, and a client never writes a place directly (the queue is first in, first out).
	 * Idempotent: a repeat answers the place as it stands (`already`); an expired place joins again at
	 * the back of the queue.
	 */
	static async joinWaitlist(blueprintId: string, actor: ReadActor): Promise<ServiceResult<WaitlistPlace>> {
		if (!actor.accessToken || !actor.userId) return signedOut();
		if (!isProjectsBackendLive()) {
			return fail(503, { message: "Joining a waitlist needs the live database." });
		}
		const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
			"join_waitlist",
			{
				p_blueprint_id: blueprintId,
			},
		);
		if (error) return refusal(error);
		const row = data as { status?: unknown; already?: unknown } | null;
		const status = WaitlistStatusSchema.safeParse(row?.status);
		if (!status.success) {
			return fail(502, { message: "That couldn't be done just now. Please try again." });
		}
		const already = row?.already === true;
		return ok({ status: status.data, already }, { status: already ? 200 : 201 });
	}

	/**
	 * The caller's own place on a listing's waitlist (`projects.get_waitlist_place`, Decision #455), or
	 * `null` for a guest, a viewer with no place, the fixture world, or a read that failed — the lane then
	 * resolves as it would for someone outside the queue, never with an invented place.
	 */
	static async waitlistPlace(
		blueprintId: string,
		actor: ReadActor,
	): Promise<ViewerWaitlistPlace | null> {
		if (!actor.accessToken || !actor.userId || !isProjectsBackendLive()) return null;
		try {
			const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
				"get_waitlist_place",
				{ p_blueprint_id: blueprintId },
			);
			if (error || !data) return null;
			const raw = data as RawWaitlistPlace;
			const parsed = ViewerWaitlistPlaceSchema.safeParse({
				status: raw.status,
				position: raw.position ?? null,
				holdExpiresAt: raw.hold_expires_at ? new Date(raw.hold_expires_at).toISOString() : null,
				seatsOpen: raw.seats_open ?? null,
				inviteHoldHours: raw.invite_hold_hours ?? DEFAULT_WAITLIST_INVITE_HOLD_HOURS,
			});
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}

	/**
	 * The viewer's own seats on a cohort and their seat link (Decision #522), or `null` when they hold
	 * none (or the read failed: the lane then offers no share control rather than a broken one).
	 */
	static async mySeats(cohortId: string, actor: ReadActor): Promise<ViewerSeat | null> {
		if (!actor.accessToken || !actor.userId || !isProjectsBackendLive()) return null;
		try {
			const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
				"get_my_cohort_seats",
				{ p_cohort_id: cohortId },
			);
			if (error || !data) return null;
			const raw = data as RawViewerSeat;
			const parsed = ViewerSeatSchema.safeParse({
				membershipId: raw.membership_id,
				seats: raw.seats,
				sponsored: raw.sponsored,
				canShare: raw.can_share,
				claimed: (raw.claimed ?? []).map((c) => ({
					name: c.name || `@${c.handle}`,
					handle: c.handle,
					joinedAt: new Date(c.joined_at).toISOString(),
				})),
				code: raw.code,
			});
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}

	/**
	 * Open (or return) the seat link of the caller's own membership of more than one seat
	 * (`projects.share_cohort_seats`), or close it (`projects.revoke_cohort_seat_link`).
	 */
	static async seatLink(
		action: "share" | "revoke",
		membershipId: string,
		actor: ReadActor,
	): Promise<ServiceResult<SeatLinkResult>> {
		if (!actor.accessToken || !actor.userId) return signedOut();
		if (!isProjectsBackendLive()) return fail(503, { message: "Seat links need the live database." });
		const client = getUserClient(actor.accessToken).schema("projects");
		if (action === "revoke") {
			const { error } = await client.rpc("revoke_cohort_seat_link", { p_membership_id: membershipId });
			if (error) return seatRefusal(error);
			return ok({ code: null, seatsLeft: 0, projectSlug: null, confirmation: "Link turned off. Seats already claimed stay claimed." });
		}
		const { data, error } = await client.rpc("share_cohort_seats", { p_membership_id: membershipId });
		if (error) return seatRefusal(error);
		const row = data as { code: string; seats_left: number };
		return ok({
			code: row.code,
			seatsLeft: Math.max(0, row.seats_left),
			projectSlug: null,
			confirmation: row.seats_left === 1
				? "Link ready. The first person to open it claims your spare seat."
				: `Link ready. The first ${row.seats_left} people to open it each claim a seat.`,
		});
	}

	/** What a seat link offers the signed-in person holding it, or `null` for a code that names none. */
	static async seatInvite(code: string, actor: ReadActor): Promise<SeatInviteView | null> {
		if (!actor.accessToken || !actor.userId || !isProjectsBackendLive()) return null;
		try {
			const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
				"get_cohort_seat_invite",
				{ p_code: code },
			);
			if (error || !data) return null;
			const raw = data as RawSeatInvite;
			const parsed = SeatInviteViewSchema.safeParse({
				state: raw.state,
				seatsLeft: Math.max(0, raw.seats_left),
				cohortName: raw.cohort_name,
				firstStartsAt: raw.first_start ? new Date(raw.first_start).toISOString() : null,
				sponsorName: raw.sponsor_name ?? "Someone",
				listingTitle: raw.listing_title,
				listingSlug: raw.listing_slug,
				projectSlug: raw.project_slug,
			});
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}

	/** Claim one seat through a link (`projects.claim_cohort_seat`): first come, first served. */
	static async claimSeat(code: string, actor: ReadActor): Promise<ServiceResult<SeatLinkResult>> {
		if (!actor.accessToken || !actor.userId) return signedOut();
		if (!isProjectsBackendLive()) return fail(503, { message: "Seat links need the live database." });
		const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
			"claim_cohort_seat",
			{ p_code: code },
		);
		if (error) return seatRefusal(error);
		const row = data as { project_slug: string | null; seats_left: number };
		return ok({
			code: null,
			seatsLeft: Math.max(0, row.seats_left),
			projectSlug: row.project_slug,
			confirmation: "Your seat is confirmed. The sessions are in Projects.",
		}, { status: 201 });
	}

	/**
	 * The workspace a session engagement's sidebar renders, for this viewer. `null` when the engagement
	 * is not a session, or the viewer has no access to it.
	 */
	static async workspace(
		slug: string,
		actor: ReadActor,
		fixture: { projectId: string; kind: "normal" | "group"; viewerIsClient: boolean } | null = null,
	): Promise<ServiceResult<{ workspace: SessionWorkspace | null }>> {
		if (!isProjectsBackendLive()) {
			if (!fixture) return ok({ workspace: null });
			const raw = fixtureWorkspace(
				fixture.projectId,
				slug,
				fixture.kind,
				fixture.viewerIsClient ? "attendee" : "host",
				Date.now(),
			);
			return ok({ workspace: toSessionWorkspace(raw, Date.now()) });
		}
		if (!actor.accessToken) return ok({ workspace: null });
		const db = getUserClient(actor.accessToken);
		const project = await db.schema("projects").from("projects").select("id").eq("slug", slug).maybeSingle();
		if (project.error) return fail(502, { message: "This session couldn't be read just now." });
		if (!project.data) return ok({ workspace: null });
		const projectId = (project.data as { id: string }).id;
		const { data, error } = await db.schema("projects").rpc("get_session_workspace", {
			p_project_id: projectId,
		});
		if (error) return fail(502, { message: "This session couldn't be read just now." });
		if (!data) return ok({ workspace: null });
		const workspace = toSessionWorkspace(data as RawWorkspace, Date.now());
		if (workspace.role !== "host") return ok({ workspace });
		// The host's forfeits they may give back (FBP DB21), read from finance as the caller.
		const forfeits = await db.schema("finance").rpc("session_forfeits", { p_project_id: projectId });
		if (forfeits.error) return fail(502, { message: "This session couldn't be read just now." });
		return ok({
			workspace: {
				...workspace,
				forfeits: ((forfeits.data ?? []) as { escrow_id: string; title: string; amount_minor: number; currency: string }[])
					.slice(0, 200)
					.map((f) => ({
						escrowId: f.escrow_id,
						title: f.title.slice(0, 200),
						amount: {
							minor: Number(f.amount_minor),
							currency: f.currency,
							display: formatMoney(Number(f.amount_minor), f.currency, DEFAULT_LOCALE),
							origin: null,
						},
					})),
			},
		});
	}

	/** Tick or un-tick a lesson for the viewer (a seated attendee only — the definer refuses anyone else). */
	static async completeLesson(
		lessonId: string,
		done: boolean,
		actor: ReadActor,
	): Promise<ServiceResult<{ lessonId: string; done: boolean }>> {
		if (!isProjectsBackendLive()) return ok({ lessonId, done });
		if (!actor.accessToken) return signedOut();
		const { error } = await getUserClient(actor.accessToken).schema("projects").rpc("complete_lesson", {
			p_lesson_id: lessonId,
			p_done: done,
		});
		if (error) return refusal(error);
		return ok({ lessonId, done });
	}

	/**
	 * Cancel a seat under PRODUCT_SPEC's late-cancel rule (the provider's cancel always refunds; the
	 * attendee's refunds until `session_cancel_notice_hours` before the first sitting, then forfeits).
	 * A 1-1 booking is judged per sitting against each one's own start (Decision #211), so a client
	 * cancelling a block can come out `partial`: the far sittings refunded, the near ones forfeited.
	 */
	static async cancelMembership(
		membershipId: string,
		actor: ReadActor,
	): Promise<ServiceResult<SeatCancellation>> {
		if (!isProjectsBackendLive()) {
			return fail(503, { message: "Cancelling a seat needs the live database." });
		}
		if (!actor.accessToken) return signedOut();
		const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
			"cancel_cohort_membership",
			{ p_membership_id: membershipId },
		);
		if (error) return refusal(error);
		const row = data as {
			outcome: SeatCancellation["outcome"];
			amount_minor: number;
			refunded_minor?: number;
			forfeited_minor?: number;
			currency: string | null;
		};
		return ok({
			outcome: row.outcome,
			amountMinor: Number(row.amount_minor) || 0,
			refundedMinor: Number(row.refunded_minor) || 0,
			forfeitedMinor: Number(row.forfeited_minor) || 0,
			currency: row.currency,
		});
	}

	/**
	 * A link the host adds to a sitting with no room (Decision #383, rulings R2 and R7). Its payout then
	 * holds for review, which the host is told before they add it.
	 */
	static async setRoomLink(
		eventId: string,
		link: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ saved: boolean }>> {
		if (!isProjectsBackendLive()) return fail(503, { message: "A link needs the live database." });
		if (!actor.accessToken) return signedOut();
		const { error } = await getUserClient(actor.accessToken).schema("projects").rpc(
			"set_sitting_link",
			{ p_event_id: eventId, p_url: link },
		);
		if (error) return refusal(error);
		return ok({ saved: true }, { message: "Link added." });
	}

	/**
	 * The attendee's answer on a sitting with no attendance record (Decision #383, ruling R6). A yes is
	 * evidence, which the next sweep releases on; a no is an ordinary no-show claim.
	 */
	static async answerReview(
		eventId: string,
		happened: boolean,
		actor: ReadActor,
	): Promise<ServiceResult<{ answered: boolean }>> {
		if (!isProjectsBackendLive()) return fail(503, { message: "An answer needs the live database." });
		if (!actor.accessToken) return signedOut();
		const { error } = await getUserClient(actor.accessToken).schema("projects").rpc(
			"answer_session_review",
			{ p_event_id: eventId, p_happened: happened },
		);
		if (error) return refusal(error);
		return ok({ answered: true }, {
			message: happened
				? "Thanks. The payment will be released shortly."
				: "Thanks. We'll check this before any payment moves.",
		});
	}

	/**
	 * Claim the provider did not show for a sitting: stops the seat's auto-release, and — once the
	 * sitting has ended — runs the attendance audit at once (Decision #212). `status` is where the claim
	 * landed: `open` (the sitting is still running), `awaiting_response`, or a ruling the room's logs
	 * already settled (`resolved_refund` / `resolved_release`).
	 */
	static async claimNoShow(
		eventId: string,
		reason: string | null,
		actor: ReadActor,
	): Promise<ServiceResult<{ disputeId: string; status: DisputeStatus }>> {
		if (!isProjectsBackendLive()) return fail(503, { message: "A claim needs the live database." });
		if (!actor.accessToken) return signedOut();
		const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc(
			"claim_session_no_show",
			{ p_event_id: eventId, p_reason: reason },
		);
		if (error) return refusal(error);
		const row = data as { dispute_id: string; status: DisputeStatus };
		return ok({ disputeId: row.dispute_id, status: row.status }, { message: claimMessage(row.status) });
	}

	/**
	 * Record a VERIFIED delivery's presence events, which `IntegrationsBackendService.handleWebhook` has
	 * already proved are the provider's own. Each event claims its `integrations.webhook_deliveries` row
	 * in the same SQL call that records it, as the service role, so a replay is a no-op that still
	 * acknowledges. A failed write answers 503 and is redelivered; any recorded outcome is final.
	 */
	static async handlePresenceWebhook(
		events: PresenceEvent[],
	): Promise<ServiceResult<{ outcomes: PresenceOutcome[] }>> {
		if (!isSupabaseConfigured()) return fail(503, { message: "Presence can't be recorded right now." });
		const db = getServiceClient();
		const outcomes: PresenceOutcome[] = [];
		for (const e of events) {
			const { data, error } = await db.schema("integrations").rpc("fn_record_presence_delivery", {
				p_provider: e.provider,
				p_meeting_id: e.meetingId,
				p_action: e.action,
				p_at: e.at,
				p_event_key: e.providerEventId,
				p_participant_key: e.participantKey,
				p_email: e.email,
				p_registrant_id: e.registrantId,
				p_account_id: e.accountId,
			});
			if (error) return fail(503, { message: "Presence couldn't be recorded. It will be redelivered." });
			outcomes.push(((data as { outcome?: PresenceOutcome } | null)?.outcome) ?? "unmatched");
		}
		return ok({ outcomes });
	}
}
