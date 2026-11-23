import { z } from "zod";
import { FundingStatusSchema } from "../finance/funding.ts";
import { DisputeSummarySchema } from "../finance/disputes.ts";
import { IntakeAnswersSchema } from "../services/intake.ts";

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
 * `projects.cohort_status` — a cohort's lifecycle, mirrored 1:1. A group cohort is `enrolling` from
 * `open_cohort` until its enrolment close, then `active` (the sweep), and `cancelled` by `cancel_cohort`
 * before its first sitting (Decision #498); a 1-1's one-seat cohort is born `active`. `completed` has
 * no writer for a group cohort yet.
 */
export const CohortStatusSchema = z.enum(["enrolling", "active", "completed", "cancelled"]);
export type CohortStatus = z.infer<typeof CohortStatusSchema>;

/** How a group cohort's sittings repeat (`projects.cohorts.cadence`); `null` for a one-sitting cohort. */
export const CohortCadenceSchema = z.enum(["weekly", "fortnightly", "fixed"]);
export type CohortCadence = z.infer<typeof CohortCadenceSchema>;

/** Why a cohort was cancelled (`projects.cohorts.cancel_reason`), set only by `cancel_cohort`. */
export const CohortCancelReasonSchema = z.enum(["under_filled", "provider"]);
export type CohortCancelReason = z.infer<typeof CohortCancelReasonSchema>;

/** One `projects.cohorts` row (Decisions #171, #498). The opening terms are NULL on a 1-1's cohort. */
export const CohortRowSchema = z.object({
	id: uuid,
	project_id: uuid,
	project_stage_id: uuid,
	name: z.string().min(1).max(200),
	max_seats: z.number().int().min(1).max(500),
	status: CohortStatusSchema,
	created_at: iso,
	/** The fewest paid seats it runs with; at most `max_seats`. */
	min_seats: z.number().int().min(1).max(500).nullable(),
	/** When it stops taking bookings — at or before its first sitting. The instant is the state. */
	enrolment_closes_at: iso.nullable(),
	cadence: CohortCadenceSchema.nullable(),
	opened_by: uuid.nullable(),
	cancelled_at: iso.nullable(),
	cancel_reason: CohortCancelReasonSchema.nullable(),
	/** Session 1's start on a chain the listing's rolling weekly templates opened (SC11); else null. */
	chain_start: iso.nullable(),
});
export type CohortRow = z.infer<typeof CohortRowSchema>;

/**
 * The cohort a group-session listing seats buyers into (`projects.get_cohort_offer`) — real occupancy
 * (paid seats + unexpired holds), the sittings and the curriculum, and the terms it was opened on,
 * each disclosed before purchase (Decision #498): the minimum it runs with, when enrolment closes, and
 * how the sittings repeat. `null` on the offer when the listing has no cohort taking bookings.
 */
export const CohortOfferSchema = z.object({
	cohortId: uuid,
	name: z.string().min(1).max(160),
	seats: SeatCountSchema,
	firstStartsAt: iso.nullable(),
	sittings: z.array(CohortSittingSchema).max(200),
	curriculum: z.array(CurriculumModuleSchema).max(100),
	minSeats: z.number().int().min(1).max(500).nullable(),
	enrolmentClosesAt: iso.nullable(),
	cadence: CohortCadenceSchema.nullable(),
	/**
	 * Every chain a rolling listing has taking bookings, soonest first, each with its own sittings and
	 * the seats it has left (SC11). Empty for a listing whose seller opens cohorts by hand. The offer's
	 * own cohort is the earliest chain with a seat to sell.
	 */
	chains: z.array(z.object({
		cohortId: uuid,
		firstStartsAt: iso.nullable(),
		remaining: z.number().int().min(0).max(500),
		sittings: z.array(CohortSittingSchema).max(200),
	})).max(60).default([]),
});
export type CohortOffer = z.infer<typeof CohortOfferSchema>;

/** `POST /api/services/reserve-seat` — hold seats on a listing's current cohort. */
export const ReserveSeatInputSchema = z.object({
	/**
	 * The listing (its discovery id). The server resolves the cohort; a client names one only to pick a
	 * later chain of a rolling listing, and the server checks it is one of that listing's offered chains.
	 */
	subjectId: z.string().min(1).max(160),
	cohortId: uuid.optional(),
	seats: z.number().int().min(1).max(500).default(1),
	/** Anything the buyer wants the provider to know before the first sitting. */
	note: z.string().max(2000).optional(),
	/**
	 * The buyer's answers to the listing's own intake (Decision #453), held to it by the same
	 * `intakeRefusal` a 1-on-1 booking runs, and carried on the seat line to its order line.
	 */
	answers: IntakeAnswersSchema.default({}),
});
export type ReserveSeatInput = z.infer<typeof ReserveSeatInputSchema>;

/**
 * `projects.waitlist_status` — a waitlist place's lifecycle (Decision #455), mirrored 1:1: `waiting` in
 * the queue → `invited` (a seat held for `waitlist_invite_hold_hours`) → `converted` (a seat bought) or
 * `expired` (the hold lapsed unused; joining again re-queues at the back). A place that is still
 * `waiting` converts too when its buyer buys a seat directly.
 */
export const WaitlistStatusSchema = z.enum(["waiting", "invited", "expired", "converted"]);
export type WaitlistStatus = z.infer<typeof WaitlistStatusSchema>;

/** `waitlist_invite_hold_hours`'s seeded default — what a missing param reads as, here and in SQL. */
export const DEFAULT_WAITLIST_INVITE_HOLD_HOURS = 48;

/** One `projects.waitlists` row (Decisions #424, #455): a buyer queued on a group-session listing. */
export const WaitlistRowSchema = z.object({
	id: uuid,
	service_blueprint_id: uuid,
	user_id: uuid,
	status: WaitlistStatusSchema,
	created_at: iso,
	/** The place in the queue: first in, first out by `(queued_at, id)`; reset by a rejoin. */
	queued_at: iso,
	/** The invite's cohort and seat hold, and when it went out and lapses. Set together on `invited`. */
	cohort_id: uuid.nullable(),
	hold_id: uuid.nullable(),
	invited_at: iso.nullable(),
	invite_expires_at: iso.nullable(),
	/** When the place reached `converted` or `expired`. */
	resolved_at: iso.nullable(),
});
export type WaitlistRow = z.infer<typeof WaitlistRowSchema>;

/**
 * The viewer's own place on a listing's waitlist (`projects.get_waitlist_place`, Decision #455). An
 * invite whose hold has lapsed already reads `expired`. `seatsOpen` is how many seats of the listing's
 * enrolling cohort this viewer could hold now, the queue's first call counted (`null` with no cohort
 * enrolling) — an invited buyer's held seat is open to them and to nobody else.
 */
export const ViewerWaitlistPlaceSchema = z.object({
	status: WaitlistStatusSchema,
	/** 1-based among the people waiting; `null` unless `waiting`. */
	position: z.number().int().min(1).nullable(),
	/** When the held seat is released; `null` unless `invited`. */
	holdExpiresAt: iso.nullable(),
	seatsOpen: z.number().int().min(0).max(500).nullable(),
	inviteHoldHours: z.number().int().min(1).max(720),
});
export type ViewerWaitlistPlace = z.infer<typeof ViewerWaitlistPlaceSchema>;

// #region Seat links (Decision #522)
/** A seat link's code: `s-` and 24 base64url characters. Also the `/invite/:token` shape it lands on. */
export const SeatLinkCodeSchema = z.string().regex(/^s-[A-Za-z0-9_-]{24}$/);

/**
 * The viewer's own seats on a cohort (`projects.get_my_cohort_seats`): how many they hold, who claimed
 * the ones they shared, and their open link. `canShare` only for a paid membership of more than one
 * seat on a cohort that has not started.
 */
export const ViewerSeatSchema = z.object({
	membershipId: uuid,
	seats: z.number().int().min(1).max(500),
	/** This seat was claimed through someone else's link. */
	sponsored: z.boolean(),
	canShare: z.boolean(),
	claimed: z.array(z.object({
		name: z.string().min(1).max(120),
		handle: z.string().min(1).max(64),
		joinedAt: iso,
	})).max(500),
	code: SeatLinkCodeSchema.nullable(),
});
export type ViewerSeat = z.infer<typeof ViewerSeatSchema>;

/** Why a seat link can or cannot be claimed by the person holding it. */
export const SeatInviteState = z.enum(["open", "revoked", "full", "started", "ended", "host", "own", "seated"]);
export type SeatInviteState = z.infer<typeof SeatInviteState>;

/** What a seat link offers the signed-in person holding it (`projects.get_cohort_seat_invite`). */
export const SeatInviteViewSchema = z.object({
	state: SeatInviteState,
	seatsLeft: z.number().int().min(0).max(500),
	cohortName: z.string().max(200),
	firstStartsAt: iso.nullable(),
	sponsorName: z.string().max(120),
	listingTitle: z.string().max(200).nullable(),
	listingSlug: z.string().max(160).nullable(),
	projectSlug: z.string().max(120).nullable(),
});
export type SeatInviteView = z.infer<typeof SeatInviteViewSchema>;

/** `POST /api/services/seats`: open or close the buyer's link, or claim a seat through one. */
export const SeatLinkActionSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("share"), membershipId: uuid }),
	z.object({ action: z.literal("revoke"), membershipId: uuid }),
	z.object({ action: z.literal("claim"), code: SeatLinkCodeSchema }),
]);
export type SeatLinkAction = z.infer<typeof SeatLinkActionSchema>;

/** What a seat-link act answers. */
export const SeatLinkResultSchema = z.object({
	/** The link, for share; `null` after a revoke or a claim. */
	code: SeatLinkCodeSchema.nullable(),
	seatsLeft: z.number().int().min(0).max(500),
	/** Where a claimer goes next: the engagement. */
	projectSlug: z.string().max(120).nullable(),
	confirmation: z.string().max(240),
});
export type SeatLinkResult = z.infer<typeof SeatLinkResultSchema>;
// #endregion

/** One place on the seller's view of a listing's waitlist. The buyer is named by the profile directory. */
export const ListingWaitlistEntrySchema = z.object({
	userId: uuid,
	handle: z.string().min(2).max(64),
	name: z.string().min(1).max(120),
	avatar: z.string().max(2000),
	status: WaitlistStatusSchema,
	/** 1-based queue position; `null` unless `waiting`. */
	position: z.number().int().min(1).nullable(),
	queuedAt: iso,
	invitedAt: iso.nullable(),
	inviteExpiresAt: iso.nullable(),
	resolvedAt: iso.nullable(),
});
export type ListingWaitlistEntry = z.infer<typeof ListingWaitlistEntrySchema>;

/**
 * A listing's waitlist as its seller reads it (`projects.get_listing_waitlist`, Decision #455): how many
 * places are in each state, and the places — the invited first, then the queue in order, then the
 * converted and expired, newest first.
 */
export const ListingWaitlistSchema = z.object({
	counts: z.object({
		waiting: z.number().int().min(0),
		invited: z.number().int().min(0),
		expired: z.number().int().min(0),
		converted: z.number().int().min(0),
	}),
	entries: z.array(ListingWaitlistEntrySchema).max(500),
});
export type ListingWaitlist = z.infer<typeof ListingWaitlistSchema>;

/** `POST /api/services/waitlist` — queue the caller on a listing's waitlist. The server resolves it. */
export const JoinWaitlistInputSchema = z.object({
	subjectId: z.string().min(1).max(160),
});
export type JoinWaitlistInput = z.infer<typeof JoinWaitlistInputSchema>;

/** The caller's place after a join — `already` when the place existed before this call. */
export const WaitlistPlaceSchema = z.object({
	status: WaitlistStatusSchema,
	already: z.boolean(),
});
export type WaitlistPlace = z.infer<typeof WaitlistPlaceSchema>;

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
export const JoinState = z.enum([
	"not_party",
	"unfunded",
	"upcoming",
	"open",
	"ended",
	"cancelled",
]);
export type JoinState = z.infer<typeof JoinState>;

/**
 * The viewer's way into a sitting. `url` is the room's own `/meet` address, present only while `state`
 * is `open`: the provider's link stays on the server, and going through `/meet` records the join.
 */
export const SessionJoinSchema = z.object({
	eventId: uuid,
	role: z.enum(["host", "attendee"]),
	state: JoinState,
	opensAt: iso,
	closesAt: iso,
	url: z.string().startsWith("/meet/").max(120).nullable(),
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
	status: CohortStatusSchema,
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
	/**
	 * The sitting with no attendance record this attendee has been asked about (Decision #383, ruling
	 * R6), whose payment waits on their answer. `get_session_workspace.reviewable_sitting_id`.
	 */
	reviewable: SessionSittingSchema.nullable(),
	/** The next sitting with no room on the way, for its host to fix. `room_wanted_sitting_id`. */
	roomWanted: SessionSittingSchema.nullable(),
	/** The no-show claims the viewer is party to: their own, or every claim on the engagement (host). */
	disputes: z.array(DisputeSummarySchema).max(200),
});
export type SessionWorkspace = z.infer<typeof SessionWorkspaceSchema>;

/** `POST /api/sessions/sittings/[eventId]/room` — a link the host adds themselves. */
export const SittingRoomInputSchema = z.object({
	link: z.string().regex(/^https:\/\/\S+$/).max(600),
});
export type SittingRoomInput = z.infer<typeof SittingRoomInputSchema>;

/** `POST /api/sessions/sittings/[eventId]/review` — whether a sitting with no evidence happened. */
export const SessionReviewInputSchema = z.object({ happened: z.boolean() });
export type SessionReviewInput = z.infer<typeof SessionReviewInputSchema>;

/** `POST /api/sessions/sittings/[eventId]/no-show` — the attendee's account of the no-show. */
export const NoShowClaimInputSchema = z.object({
	reason: z.string().trim().max(480).nullable().default(null),
});
export type NoShowClaimInput = z.infer<typeof NoShowClaimInputSchema>;

/** `POST /api/sessions/lessons/[lessonId]` — tick or un-tick a lesson. */
export const LessonProgressInputSchema = z.object({ done: z.boolean() });
export type LessonProgressInput = z.infer<typeof LessonProgressInputSchema>;
// #endregion

// #region Sitting doors
/** The longest title a sitting takes — `schedule_sitting` / `retitle_sitting` refuse a longer one. */
export const SITTING_TITLE_MAX = 200;
/** The longest a single sitting may run, in hours — `schedule_sitting`'s `INTERVAL '24 hours'`. */
export const SITTING_MAX_HOURS = 24;

const sittingTitle = z.string().trim().min(1).max(SITTING_TITLE_MAX);

/**
 * `projects.schedule_sitting` — the provider adds a sitting to a GROUP cohort they host (00001155
 * §4c). The sitting is mirrored onto their calendar with no roster, so it blocks their free/busy and
 * both booking gates, and no reschedule vote can move it. Once a seat is taken the database also
 * refuses a sitting before the cohort's first one (and a first sitting inside the cancellation notice):
 * a seat's refund is judged against that first sitting.
 */
export const ScheduleSittingInputSchema = z.object({
	cohortId: uuid,
	title: sittingTitle,
	startsAt: iso,
	endsAt: iso,
}).refine(
	(v) => {
		const span = Date.parse(v.endsAt) - Date.parse(v.startsAt);
		return Number.isFinite(span) && span > 0 && span <= SITTING_MAX_HOURS * 3_600_000;
	},
	{
		message: `A session needs a start and a later end, at most ${SITTING_MAX_HOURS} hours apart.`,
		path: ["endsAt"],
	},
);
export type ScheduleSittingInput = z.infer<typeof ScheduleSittingInputSchema>;

/** `projects.retitle_sitting` — the provider renames one of their sittings and its calendar mirror. */
export const RetitleSittingInputSchema = z.object({
	sittingId: uuid,
	title: sittingTitle,
});
export type RetitleSittingInput = z.infer<typeof RetitleSittingInputSchema>;

/** What either door answers: the sitting as it now stands, and its calendar mirror. */
export const SittingWriteSchema = z.object({
	sittingId: uuid,
	slug: z.string().regex(/^ssn-[23456789abcdefghjkmnopqrstuvwxyz]{10}$/),
	calendarEventId: uuid.nullable(),
	title: z.string().min(1).max(SITTING_TITLE_MAX),
	startsAt: iso,
	endsAt: iso,
});
export type SittingWrite = z.infer<typeof SittingWriteSchema>;
// #endregion

// #region Opening a cohort (Decision #498)
/** The most sittings a cohort can have — the listing's `session_count` bound. */
export const COHORT_SITTINGS_MAX = 52;

/**
 * `POST /api/catalogue/cohorts` → `projects.open_cohort`: the seller opens a cohort on a group-session
 * listing they manage. The sitting count and length are the listing's (`session_count`,
 * `session_minutes`), never the request's. `cadence` is required when the listing has more than one
 * sitting; `laterStartsAt` names sittings 2…n and goes only with `fixed`. `maxSeats` absent reads the
 * listing's cohort size; `enrolmentClosesAt` absent closes at the first sitting, and with a minimum it
 * must fall before it. The database re-checks all of it, the calendar included.
 */
export const OpenCohortInputSchema = z.object({
	/** The listing's `svc-…` slug, resolved against the caller's own listings. */
	listing: z.string().min(1).max(160),
	firstStartsAt: iso,
	cadence: CohortCadenceSchema.nullable().default(null),
	laterStartsAt: z.array(iso).max(COHORT_SITTINGS_MAX - 1).default([]),
	maxSeats: z.number().int().min(1).max(500).nullable().default(null),
	minSeats: z.number().int().min(1).max(500).nullable().default(null),
	enrolmentClosesAt: iso.nullable().default(null),
	name: z.string().trim().max(SITTING_TITLE_MAX).nullable().default(null),
}).superRefine((v, ctx) => {
	const first = Date.parse(v.firstStartsAt);
	if (!Number.isFinite(first)) {
		ctx.addIssue({
			code: "custom",
			path: ["firstStartsAt"],
			message: "Pick when the first session starts.",
		});
		return;
	}
	if (v.minSeats !== null && v.maxSeats !== null && v.minSeats > v.maxSeats) {
		ctx.addIssue({
			code: "custom",
			path: ["minSeats"],
			message: "The minimum can't be more than the cohort's size.",
		});
	}
	if (v.enrolmentClosesAt !== null) {
		const close = Date.parse(v.enrolmentClosesAt);
		if (!Number.isFinite(close) || close > first) {
			ctx.addIssue({
				code: "custom",
				path: ["enrolmentClosesAt"],
				message: "Enrolment has to close no later than the first session.",
			});
		} else if (v.minSeats !== null && close >= first) {
			ctx.addIssue({
				code: "custom",
				path: ["enrolmentClosesAt"],
				message: "With a minimum, enrolment has to close before the first session.",
			});
		}
	} else if (v.minSeats !== null) {
		ctx.addIssue({
			code: "custom",
			path: ["enrolmentClosesAt"],
			message: "With a minimum, choose when enrolment closes, before the first session.",
		});
	}
	if (v.cadence !== "fixed" && v.laterStartsAt.length > 0) {
		ctx.addIssue({
			code: "custom",
			path: ["laterStartsAt"],
			message: "Dates of your own go with fixed dates.",
		});
	}
});
export type OpenCohortInput = z.infer<typeof OpenCohortInputSchema>;

/** `POST /api/catalogue/cohorts/[cohortId]/cancel` — names the cohort; the body carries nothing. */
export const CancelCohortInputSchema = z.object({ cohortId: uuid });
export type CancelCohortInput = z.infer<typeof CancelCohortInputSchema>;

// #region Rolling weekly templates (SC11)
/**
 * `marketplace.service_blueprints.group_schedule_mode`, mirrored 1:1: how a Group Session's cohorts are
 * opened. `fixed_cohorts` (the default) — the seller opens each by hand; `rolling_templates` — every
 * occurrence of session 1's weekly template within the horizon starts a chain, opened as a cohort.
 */
export const GroupScheduleModeSchema = z.enum(["fixed_cohorts", "rolling_templates"]);
export type GroupScheduleMode = z.infer<typeof GroupScheduleModeSchema>;

/** Minutes in a week, the span a weekly template wraps around. */
const WEEK_MINUTES = 7 * 24 * 60;

/**
 * One sitting's weekly template (`session_template_rules.weekly[k]`): an ISO weekday (1 Monday … 7
 * Sunday) and its start in minutes after midnight, in the seller's own zone.
 */
export const WeeklySessionTemplateSchema = z.object({
	weekday: z.number().int().min(1).max(7),
	startMinute: z.number().int().min(0).max(1439),
});
export type WeeklySessionTemplate = z.infer<typeof WeeklySessionTemplateSchema>;

/**
 * Why a week of templates cannot run, or `null` — the rule `projects.fn_weekly_templates_refusal` holds:
 * at most {@link COHORT_SITTINGS_MAX} templates, and no two whose weekly spans overlap (the week wraps,
 * so Sunday night runs into Monday morning). `lengths[k]` is sitting k's length in minutes. Overlapping
 * templates would make one chain's session k another chain's session 1.
 */
export function weeklyTemplatesProblem(
	templates: readonly WeeklySessionTemplate[],
	lengths: readonly number[],
): string | null {
	if (templates.length > COHORT_SITTINGS_MAX) {
		return `A listing has at most ${COHORT_SITTINGS_MAX} weekly session times`;
	}
	const at = templates.map((t) => (t.weekday - 1) * 1440 + t.startMinute);
	const len = templates.map((_, k) => Math.max(1, lengths[k] ?? 60));
	for (let i = 0; i < at.length; i++) {
		for (let j = i + 1; j < at.length; j++) {
			const gap = (((at[j] - at[i]) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
			if (gap < len[i] || WEEK_MINUTES - gap < len[j]) {
				return `Sessions ${i + 1} and ${j + 1} overlap in the week — give each its own time`;
			}
		}
	}
	return null;
}

/** `PUT /api/catalogue/group-schedule` — a group-session listing's cohort schedule. */
export const SaveGroupScheduleInputSchema = z.object({
	/** The listing (its catalogue id). */
	listing: z.string().min(1).max(160),
	mode: GroupScheduleModeSchema,
	/** One per sitting, by position; stored whole. */
	templates: z.array(WeeklySessionTemplateSchema).max(COHORT_SITTINGS_MAX),
});
export type SaveGroupScheduleInput = z.infer<typeof SaveGroupScheduleInputSchema>;

/** What `projects.save_group_schedule` answers: the schedule as stored and how many chains it opened. */
export const GroupScheduleSavedSchema = z.object({
	mode: GroupScheduleModeSchema,
	templates: z.array(WeeklySessionTemplateSchema).max(COHORT_SITTINGS_MAX),
	opened: z.number().int().min(0),
});
export type GroupScheduleSaved = z.infer<typeof GroupScheduleSavedSchema>;
// #endregion

/**
 * Where a cohort stands for its seller (`get_listing_cohorts.phase`): `closed` once its enrolment
 * close has passed and before its first sitting, `running` from its first sitting on.
 */
export const CohortPhaseSchema = z.enum([
	"enrolling",
	"closed",
	"running",
	"cancelled",
	"completed",
]);
export type CohortPhase = z.infer<typeof CohortPhaseSchema>;

/** One sitting of a seller's cohort. */
export const ListingCohortSittingSchema = z.object({
	id: uuid,
	slug: z.string().regex(/^ssn-[23456789abcdefghjkmnopqrstuvwxyz]{10}$/),
	title: z.string().min(1).max(SITTING_TITLE_MAX),
	startsAt: iso,
	endsAt: iso,
	status: z.string().min(1).max(40),
});
export type ListingCohortSitting = z.infer<typeof ListingCohortSittingSchema>;

/**
 * One cohort as its seller reads it (`projects.get_listing_cohorts`). `underFilled` and `canCancel`
 * are the database's answers; the island renders them and never derives either.
 */
export const ListingCohortSchema = z.object({
	cohortId: uuid,
	name: z.string().min(1).max(200),
	status: CohortStatusSchema,
	phase: CohortPhaseSchema,
	maxSeats: z.number().int().min(1).max(500),
	minSeats: z.number().int().min(1).max(500).nullable(),
	seatsPaid: z.number().int().min(0).max(500),
	seatsHeld: z.number().int().min(0).max(500),
	enrolmentClosesAt: iso.nullable(),
	cadence: CohortCadenceSchema.nullable(),
	firstStartsAt: iso.nullable(),
	lastEndsAt: iso.nullable(),
	underFilled: z.boolean(),
	canCancel: z.boolean(),
	cancelReason: CohortCancelReasonSchema.nullable(),
	cancelledAt: iso.nullable(),
	projectSlug: z.string().min(1).max(120).nullable(),
	/** Opened by the listing's rolling weekly templates (`cohorts.chain_start` set, SC11). */
	generated: z.boolean().default(false),
	sittings: z.array(ListingCohortSittingSchema).max(COHORT_SITTINGS_MAX),
});
export type ListingCohort = z.infer<typeof ListingCohortSchema>;

/**
 * `GET /api/catalogue/cohorts?listing=` — what the opening form needs from the listing, and its
 * cohorts: taking bookings and running first, then the last 90 days' cancelled and completed ones.
 */
export const ListingCohortsSchema = z.object({
	sessionCount: z.number().int().min(1).max(COHORT_SITTINGS_MAX),
	sessionMinutes: z.number().int().min(5).max(600),
	cohortSize: z.number().int().min(1).max(500),
	/** How the listing's cohorts open, and the weekly templates a rolling listing runs on (SC11). */
	scheduleMode: GroupScheduleModeSchema.default("fixed_cohorts"),
	weeklyTemplates: z.array(WeeklySessionTemplateSchema).max(COHORT_SITTINGS_MAX).default([]),
	/** The zone the templates are read in: the seller's calendar zone. */
	timezone: z.string().min(1).max(64).default("UTC"),
	/** How many weeks ahead a rolling listing keeps its chains open (`rolling_horizon_weeks`). */
	horizonWeeks: z.number().int().min(1).max(52).default(4),
	cohorts: z.array(ListingCohortSchema).max(20),
});
export type ListingCohorts = z.infer<typeof ListingCohortsSchema>;

/** What `cancel_cohort` did: the seats it refunded and the waitlist places it put back. */
export const CohortCancellationSchema = z.object({
	cohortId: uuid,
	reason: CohortCancelReasonSchema,
	seatsRefunded: z.number().int().min(0),
	refundedMinor: z.number().int().min(0),
	currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
	placesRestored: z.number().int().min(0),
	waitlistTold: z.number().int().min(0),
});
export type CohortCancellation = z.infer<typeof CohortCancellationSchema>;

/**
 * The start of each sitting a cohort would have, for the opening form's preview: the first, then a
 * week or two apart at the same wall-clock time in the viewer's zone, or the seller's own dates. The
 * database computes the real ones in the provider's zone; this is only what the form shows first.
 */
export function previewCohortStarts(
	firstStartsAt: string,
	cadence: CohortCadence | null,
	count: number,
	laterStartsAt: readonly string[] = [],
): string[] {
	const first = new Date(firstStartsAt);
	if (!Number.isFinite(first.getTime())) return [];
	const n = Math.max(1, Math.min(COHORT_SITTINGS_MAX, Math.trunc(count)));
	if (n === 1) return [first.toISOString()];
	if (cadence === "fixed") return [first.toISOString(), ...laterStartsAt.slice(0, n - 1)];
	if (cadence === null) return [first.toISOString()];
	const step = cadence === "weekly" ? 7 : 14;
	return Array.from({ length: n }, (_, k) => {
		const d = new Date(first.getTime());
		d.setDate(d.getDate() + step * k);
		return d.toISOString();
	});
}

/** "Weekly · 6 sessions" — how a cohort's sittings repeat, as one quiet line. */
export function cohortCadenceLabel(cadence: CohortCadence | null, count: number): string {
	const sessions = `${count} ${count === 1 ? "session" : "sessions"}`;
	switch (cadence) {
		case "weekly":
			return `Weekly · ${sessions}`;
		case "fortnightly":
			return `Every two weeks · ${sessions}`;
		case "fixed":
			return `${sessions} on set dates`;
		default:
			return count === 1 ? "One session" : sessions;
	}
}
// #endregion

// #region Presence
/**
 * One participant joining or leaving a room, reduced from a provider's webhook by its adapter. The
 * provider's own field names stop at the adapter; `projects.record_presence` takes exactly this.
 */
export const PresenceEventSchema = z.object({
	provider: z.enum(["zoom"]),
	meetingId: z.string().min(1).max(120),
	/** The participant's email, when the provider reports one: the weakest way to know them. */
	email: z.string().max(320).nullable(),
	action: z.enum(["joined", "left", "waiting"]),
	at: iso,
	/** The provider's identity for this delivery, so a redelivery is a replay. */
	providerEventId: z.string().min(1).max(200),
	/** Tells one participant from another even when nobody can name them. The door hashes it. */
	participantKey: z.string().min(1).max(320),
	/** Their own registration at the provider, when they came through a personal link. */
	registrantId: z.string().max(120).nullable(),
	/** Their account at the provider, which is how a room knows its host. */
	accountId: z.string().max(120).nullable(),
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

/** `scheduling.record_presence`'s answer. */
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
