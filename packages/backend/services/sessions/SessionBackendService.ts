import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
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
	type PresenceOutcome,
	type SeatHold,
	seatCount,
	type SessionWorkspace,
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
import { PRESENCE_ADAPTERS } from "./presence/mod.ts";

/**
 * SessionBackendService — the fat service behind session and group-session engagements (Decision
 * #171): the cohort a listing seats into, seat holds, the workspace the session sidebars render, the
 * curriculum, cancellations under the late-cancel rule, no-show claims, and the presence webhook.
 *
 * It computes no money and decides no rule the database decides: every write is one of the definers in
 * `00001155_functions_projects_sessions.sql`, run as the caller (RLS and `auth.uid()` are the real
 * gates), and every read maps through `workspace-model.ts`. The only service-role call is the presence
 * webhook's, after its provider signature verified.
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
		const { data, error } = await getUserClient(actor.accessToken).schema("projects").rpc("reserve_seat", {
			p_cohort_id: offer.cohortId,
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
			firstStartsAt: offer.firstStartsAt,
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
		const { data, error } = await db.schema("projects").rpc("get_session_workspace", {
			p_project_id: (project.data as { id: string }).id,
		});
		if (error) return fail(502, { message: "This session couldn't be read just now." });
		return ok({ workspace: data ? toSessionWorkspace(data as RawWorkspace, Date.now()) : null });
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
	 * A conferencing provider's presence webhook. The raw body and headers go to the provider's adapter
	 * untouched (its signature is over the exact bytes), and only a verified delivery is acted on: a
	 * handshake is answered, and each participant join/leave goes to `projects.record_presence` as the
	 * service role. The status is the provider's contract — 2xx acknowledges (an ignored event too), 400
	 * refuses a forged or stale delivery, 503 asks for a redelivery.
	 */
	static async handlePresenceWebhook(
		provider: string,
		raw: string,
		headers: Headers,
		nowMs = Date.now(),
	): Promise<ServiceResult<{ received: true; challenge?: Record<string, string>; outcomes: PresenceOutcome[] }>> {
		const adapter = PRESENCE_ADAPTERS[provider];
		if (!adapter) return fail(404, { message: "Unknown conferencing provider." });
		const secret = adapter.secret();
		if (!secret) return fail(503, { message: "Presence for this provider isn't configured." });
		if (!(await adapter.verify(raw, headers, secret, nowMs))) {
			return fail(400, { message: "The delivery's signature didn't verify." });
		}
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch {
			return fail(400, { message: "The delivery isn't JSON." });
		}
		const challenge = await adapter.challenge(body, secret);
		if (challenge) return ok({ received: true, challenge, outcomes: [] });

		const events = adapter.parse(body);
		if (events.length === 0) return ok({ received: true, outcomes: [] });
		if (!isSupabaseConfigured()) return fail(503, { message: "Presence can't be recorded right now." });
		const db = getServiceClient();
		const outcomes: PresenceOutcome[] = [];
		for (const e of events) {
			const { data, error } = await db.schema("projects").rpc("record_presence", {
				p_provider: e.provider,
				p_meeting_id: e.meetingId,
				p_email: e.email,
				p_action: e.action,
				p_at: e.at,
				p_provider_event_id: e.providerEventId,
			});
			// A failed write is redelivered by the provider; a recorded outcome (even "unmatched") is final.
			if (error) return fail(503, { message: "Presence couldn't be recorded. It will be redelivered." });
			outcomes.push(((data as { outcome?: PresenceOutcome } | null)?.outcome) ?? "unmatched");
		}
		return ok({ received: true, outcomes });
	}
}
