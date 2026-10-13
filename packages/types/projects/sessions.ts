import { z } from "zod";
import { FundingStatusSchema } from "../finance/funding.ts";
import { DisputeSummarySchema } from "../finance/disputes.ts";

/**
 * projects.sessions — the Zod SSOT for session and group-session engagements (Decision #171): the
 * cohort a listing seats into, a seat hold, the workspace a session's sidebars render, the curriculum,
 * the join link, and the normalised presence event a conferencing webhook is reduced to.
 *
 * Mirrors `supabase/migrations/00001155_functions_projects_sessions.sql`. A 1-1 session is a cohort of
 * one seat, so one vocabulary serves both kinds. Every figure here is server-resolved: islands render
 * it and never derive a seat count, a join window or a funding state.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
const iso = z.string().max(40);
// #endregion

// #region Terms
/** The platform's session terms (`security.platform_params`), read once so copy states the real figures. */
export const SessionTermsSchema = z.object({
	/** `seat_hold_minutes` — how long a reserved seat is held while its buyer pays. */
	seatHoldMinutes: z.number().int().min(1).max(1440),
	/** `session_join_lead_minutes` — how early a join link opens. */
	joinLeadMinutes: z.number().int().min(0).max(240),
	/** `session_presence_minutes` — the 15-minute presence rule's window. */
	presenceMinutes: z.number().int().min(1).max(240),
	/** `session_cancel_notice_hours` — inside this, an attendee's cancel forfeits the seat. */
	cancelNoticeHours: z.number().int().min(0).max(720),
	/** `session_payout_hours` — negative-consent window after the last sitting. */
	payoutHours: z.number().int().min(0).max(720),
});
export type SessionTerms = z.infer<typeof SessionTermsSchema>;

/** The seeded defaults — what a missing param reads as, here and in SQL. */
export const DEFAULT_SESSION_TERMS: SessionTerms = {
	seatHoldMinutes: 15,
	joinLeadMinutes: 10,
	presenceMinutes: 15,
	cancelNoticeHours: 24,
	payoutHours: 24,
};
// #endregion

// #region Seats
/** A cohort's seat position. `sentence` is the accessible fact the decorative meter stands beside. */
export const SeatCountSchema = z.object({
	total: z.number().int().min(0).max(500),
	taken: z.number().int().min(0).max(500),
	remaining: z.number().int().min(0).max(500),
	sentence: z.string().max(160),
});
export type SeatCount = z.infer<typeof SeatCountSchema>;

/** "4 of 10 seats remaining" — a number in words beside the meter (DESIGN_SYSTEM §D.8.4). */
export function seatCount(total: number, taken: number): SeatCount {
	const t = Math.max(0, Math.min(total, taken));
	const remaining = Math.max(0, total - t);
	return {
		total,
		taken: t,
		remaining,
		sentence: remaining === 0
			? `All ${total} ${total === 1 ? "seat" : "seats"} taken`
			: `${remaining} of ${total} ${total === 1 ? "seat" : "seats"} remaining`,
	};
}
// #endregion

// #region Curriculum
/** One lesson. `done` is the viewer's progress; `null` when the viewer has none to keep (not seated). */
export const CurriculumLessonSchema = z.object({
	id: uuid,
	title: z.string().min(1).max(160),
	durationMinutes: z.number().int().min(1).max(1440).nullable(),
	done: z.boolean().nullable(),
});
export type CurriculumLesson = z.infer<typeof CurriculumLessonSchema>;

/** One module, dated by the sitting it is taught in (`startsAt`), or undated. */
export const CurriculumModuleSchema = z.object({
	id: uuid,
	title: z.string().min(1).max(160),
	summary: z.string().max(2000),
	startsAt: iso.nullable(),
	lessons: z.array(CurriculumLessonSchema).max(100),
});
export type CurriculumModule = z.infer<typeof CurriculumModuleSchema>;
// #endregion

// #region The listing's cohort offer
/** One scheduled sitting, as the public listing discloses it. */
export const CohortSittingSchema = z.object({
	id: uuid,
	title: z.string().min(1).max(200),
	startsAt: iso,
	endsAt: iso,
});
export type CohortSitting = z.infer<typeof CohortSittingSchema>;

/**
 * The cohort a group-session listing seats buyers into (`projects.get_cohort_offer`) — real occupancy
 * (paid seats + unexpired holds), the sittings and the curriculum. `null` on the offer when the
 * listing has no enrolling cohort.
 */
export const CohortOfferSchema = z.object({
	cohortId: uuid,
	name: z.string().min(1).max(160),
	seats: SeatCountSchema,
	firstStartsAt: iso.nullable(),
	sittings: z.array(CohortSittingSchema).max(200),
	curriculum: z.array(CurriculumModuleSchema).max(100),
});
export type CohortOffer = z.infer<typeof CohortOfferSchema>;

/** `POST /api/sessions/reserve` — hold seats on a listing's current cohort. */
export const ReserveSeatInputSchema = z.object({
	/** The listing (its discovery id). The server resolves the cohort; a client never names one. */
	subjectId: z.string().min(1).max(160),
	seats: z.number().int().min(1).max(500).default(1),
});
export type ReserveSeatInput = z.infer<typeof ReserveSeatInputSchema>;

/** A placed hold — what the Buy Now hand-off carries onto the basket line (`metadata.holdId`). */
export const SeatHoldSchema = z.object({
	holdId: uuid,
	cohortId: uuid,
	seats: z.number().int().min(1).max(500),
	expiresAt: iso,
	seatsAfter: SeatCountSchema,
});
export type SeatHold = z.infer<typeof SeatHoldSchema>;
// #endregion

// #region Workspace
/** How the viewer stands toward a session engagement. */
export const SessionRole = z.enum(["host", "attendee", "prospect"]);
export type SessionRole = z.infer<typeof SessionRole>;

/** Where a sitting is relative to now (live = between its start and its end). */
export const SittingPhase = z.enum(["upcoming", "live", "ended", "cancelled"]);
export type SittingPhase = z.infer<typeof SittingPhase>;

/** Why there is (or is not) a join URL — `projects.session_join_link`'s `state`. */
export const JoinState = z.enum(["not_party", "unfunded", "upcoming", "open", "ended", "cancelled"]);
export type JoinState = z.infer<typeof JoinState>;

/** The viewer's way into a sitting. `url` is present only while `state` is `open`. */
export const SessionJoinSchema = z.object({
	eventId: uuid,
	role: z.enum(["host", "attendee"]),
	state: JoinState,
	opensAt: iso,
	closesAt: iso,
	url: z.string().url().max(2000).nullable(),
});
export type SessionJoin = z.infer<typeof SessionJoinSchema>;

/** One sitting in the workspace. */
export const SessionSittingSchema = z.object({
	id: uuid,
	title: z.string().min(1).max(200),
	startsAt: iso,
	endsAt: iso,
	phase: SittingPhase,
	/** 1-based position among the cohort's sittings ("Session 3 of 10"). */
	index: z.number().int().min(1),
	total: z.number().int().min(1),
});
export type SessionSitting = z.infer<typeof SessionSittingSchema>;

/** A cohort as the workspace lists it — a group session's sub-group. */
export const CohortViewSchema = z.object({
	id: uuid,
	name: z.string().min(1).max(160),
	status: z.enum(["enrolling", "active", "completed", "cancelled"]),
	seats: SeatCountSchema,
	/** The viewer holds a seat on it. */
	joined: z.boolean(),
	nextStartsAt: iso.nullable(),
	/** Its next sitting overlaps another cohort's next sitting. */
	overlapping: z.boolean(),
});
export type CohortView = z.infer<typeof CohortViewSchema>;

/** The viewer's own seat, and what cancelling it now would do (PRODUCT_SPEC's late-cancel rule). */
export const SessionMembershipSchema = z.object({
	id: uuid,
	cohortId: uuid,
	status: z.enum(["active", "cancelled", "completed"]),
	seats: z.number().int().min(1).max(500),
	/** `refunded` while the first sitting is more than the notice away, else `forfeited`. */
	cancelOutcome: z.enum(["refunded", "forfeited"]).nullable(),
	/** A no-show claim is open against the seat's escrow (auto-release waits for it). */
	claimOpen: z.boolean(),
});
export type SessionMembership = z.infer<typeof SessionMembershipSchema>;

/** A live reschedule round on one of the engagement's sittings. */
export const SessionVoteSchema = z.object({
	prompt: z.string().max(200),
	accepted: z.number().int().min(0),
	total: z.number().int().min(0),
});
export type SessionVote = z.infer<typeof SessionVoteSchema>;

/** Everything a session engagement's sidebar renders, for one viewer. */
export const SessionWorkspaceSchema = z.object({
	projectId: uuid,
	slug: z.string().min(1).max(120),
	kind: z.enum(["normal", "group"]),
	role: SessionRole,
	terms: SessionTermsSchema,
	cohorts: z.array(CohortViewSchema).max(50),
	/** The viewer's next (or current) sitting. */
	next: SessionSittingSchema.nullable(),
	join: SessionJoinSchema.nullable(),
	curriculum: z.array(CurriculumModuleSchema).max(100),
	membership: SessionMembershipSchema.nullable(),
	/** The viewer's seat funding (attendee) or the engagement's roll-up (host). */
	funding: FundingStatusSchema.nullable(),
	vote: SessionVoteSchema.nullable(),
	/** A reschedule of the next sitting awaiting the other party, and who proposed it (1-1 badge). */
	proposal: z.enum(["host", "attendee"]).nullable(),
	/** Every sitting has ended (unlocks the 1-1 continuation). */
	presetEnded: z.boolean(),
	/**
	 * The sitting an attendee may report a no-show on now (Decision #212): the latest started one whose
	 * escrow is still held and carries no claim — `get_session_workspace.claimable_sitting_id`. Null for
	 * a host, a prospect, or when nothing is reportable.
	 */
	claimable: SessionSittingSchema.nullable(),
	/** The no-show claims the viewer is party to: their own, or every claim on the engagement (host). */
	disputes: z.array(DisputeSummarySchema).max(200),
});
export type SessionWorkspace = z.infer<typeof SessionWorkspaceSchema>;

/** `POST /api/sessions/sittings/[eventId]/no-show` — the attendee's account of the no-show. */
export const NoShowClaimInputSchema = z.object({
	reason: z.string().trim().max(480).nullable().default(null),
});
export type NoShowClaimInput = z.infer<typeof NoShowClaimInputSchema>;

/** `POST /api/sessions/lessons/[lessonId]` — tick or un-tick a lesson. */
export const LessonProgressInputSchema = z.object({ done: z.boolean() });
export type LessonProgressInput = z.infer<typeof LessonProgressInputSchema>;
// #endregion

// #region Presence
/**
 * One participant joining or leaving a room, reduced from a provider's webhook by its adapter. The
 * provider's own field names stop at the adapter; `projects.record_presence` takes exactly this.
 */
export const PresenceEventSchema = z.object({
	provider: z.enum(["zoom"]),
	meetingId: z.string().min(1).max(120),
	/** The participant's email, when the provider reports one; without it nobody can be matched. */
	email: z.string().max(320).nullable(),
	action: z.enum(["joined", "left"]),
	at: iso,
	/** The provider's identity for this delivery, so a redelivery is a replay. */
	providerEventId: z.string().min(1).max(200),
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

/** `record_presence`'s answer. */
export const PresenceOutcome = z.enum(["recorded", "replayed", "unmatched", "outside_window"]);
export type PresenceOutcome = z.infer<typeof PresenceOutcome>;
// #endregion

// #region Time helpers
/** Where a sitting sits relative to `now` — the one rule the workspace and the dev preview share. */
export function sittingPhase(
	s: { startsAt: string; endsAt: string; cancelled?: boolean },
	now: number,
): SittingPhase {
	if (s.cancelled) return "cancelled";
	if (now >= Date.parse(s.endsAt)) return "ended";
	if (now >= Date.parse(s.startsAt)) return "live";
	return "upcoming";
}

/**
 * What cancelling a seat now would do: a full refund while the cohort's first sitting is more than
 * the notice away, a full forfeit inside it or once the cohort has begun (PRODUCT_SPEC §Session-Based
 * C). Mirrors `projects.cancel_cohort_membership`, which is the authority.
 */
export function cancelOutcomeAt(
	firstStartsAt: string | null,
	now: number,
	noticeHours: number,
): "refunded" | "forfeited" {
	if (!firstStartsAt) return "refunded";
	return Date.parse(firstStartsAt) - now > noticeHours * 3_600_000 ? "refunded" : "forfeited";
}
// #endregion
