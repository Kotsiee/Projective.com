/**
 * @projective/types/reviews — the Zod SSOT for `reviews.entity_reviews`, the doors that write it and
 * the two reads the review dialog and the review lists use (Decision #487; PRODUCT_SPEC §Reputation 3;
 * `documentation/database/reviews/`), and the Client Trust Score with its warning (Decision #486).
 *
 * The database decides every rule: who may review what, the 30-day window, the one reply. These
 * schemas bound the request a route accepts and the rows a service maps, field for field.
 */

import { z } from "zod";
import { slugPattern } from "../slugs/slug.ts";

// #region Constants
/** How long an anchor stays reviewable after it completed (reviews.fn_review_window). */
export const REVIEW_WINDOW_DAYS = 30;
/** How long a reply stays editable (reviews.fn_reply_edit_window). */
export const REPLY_EDIT_DAYS = 7;
/** The comment's floor (`entity_reviews.comment` CHECK) and the door's ceiling. */
export const REVIEW_COMMENT_MIN = 100;
export const REVIEW_COMMENT_MAX = 5000;
/** The headline's ceiling (`entity_reviews_title_check`). */
export const REVIEW_TITLE_MAX = 120;
/** A reply's bounds (`entity_reviews.reply_comment` CHECK). */
export const REVIEW_REPLY_MAX = 1000;
// #endregion

// #region Vocabulary
/** `reviews.review_target_type`, member for member. */
export const ReviewTargetTypeSchema = z.enum([
	"user",
	"freelancer",
	"business",
	"team",
	"service_blueprint",
	"product",
]);
export type ReviewTargetType = z.infer<typeof ReviewTargetTypeSchema>;

/**
 * What a review rests on: an engagement (`project`), a session seat (`cohort_membership`) or a
 * product purchase (`order_line`, refused until CK1 records a delivery).
 */
export const ReviewAnchorKindSchema = z.enum(["project", "cohort_membership", "order_line"]);
export type ReviewAnchorKind = z.infer<typeof ReviewAnchorKindSchema>;
// #endregion

// #region The row
/** One `reviews.entity_reviews` row, column for column (00000019). */
export const EntityReviewRowSchema = z.object({
	id: z.string().uuid(),
	target_entity_id: z.string().uuid(),
	target_entity_type: ReviewTargetTypeSchema,
	reviewer_user_id: z.string().uuid(),
	reviewer_business_id: z.string().uuid().nullable(),
	reviewer_team_id: z.string().uuid().nullable(),
	project_id: z.string().uuid().nullable(),
	stage_assignment_id: z.string().uuid().nullable(),
	cohort_membership_id: z.string().uuid().nullable(),
	session_event_id: z.string().uuid().nullable(),
	order_line_id: z.string().uuid().nullable(),
	service_blueprint_id: z.string().uuid().nullable(),
	window_closes_at: z.string(),
	rating: z.coerce.number().min(1).max(5),
	title: z.string().max(REVIEW_TITLE_MAX).nullable(),
	comment: z.string().min(REVIEW_COMMENT_MIN),
	edited_at: z.string().nullable(),
	withdrawn_at: z.string().nullable(),
	hidden_at: z.string().nullable(),
	hidden_reason: z.string().max(500).nullable(),
	hidden_by: z.string().uuid().nullable(),
	/** NULL while an engagement review waits, blind, for the other side's (Decision #486 (A)). */
	revealed_at: z.string().nullable(),
	is_visible: z.boolean(),
	reply_comment: z.string().max(REVIEW_REPLY_MAX).nullable(),
	reply_user_id: z.string().uuid().nullable(),
	replied_at: z.string().nullable(),
	reply_edited_at: z.string().nullable(),
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});
export type EntityReviewRow = z.infer<typeof EntityReviewRowSchema>;
// #endregion

// #region Door inputs
const trimmed = (max: number) => z.string().trim().max(max);

/** A rating in whole or half stars, as the dialog offers it; the door accepts two decimals. */
export const ReviewRatingSchema = z.coerce.number().min(1).max(5).multipleOf(0.5);

/** `POST /api/reviews` → reviews.submit_review. */
export const SubmitReviewInputSchema = z.object({
	anchorKind: ReviewAnchorKindSchema,
	anchorId: z.string().uuid(),
	targetType: ReviewTargetTypeSchema,
	targetId: z.string().uuid(),
	rating: ReviewRatingSchema,
	title: trimmed(REVIEW_TITLE_MAX).optional().transform((v) => (v ? v : null)),
	comment: z.string().trim().min(REVIEW_COMMENT_MIN).max(REVIEW_COMMENT_MAX),
});
export type SubmitReviewInput = z.infer<typeof SubmitReviewInputSchema>;

/** `PATCH /api/reviews/:id` → reviews.edit_review. */
export const EditReviewInputSchema = z.object({
	rating: ReviewRatingSchema,
	title: trimmed(REVIEW_TITLE_MAX).optional().transform((v) => (v ? v : null)),
	comment: z.string().trim().min(REVIEW_COMMENT_MIN).max(REVIEW_COMMENT_MAX),
});
export type EditReviewInput = z.infer<typeof EditReviewInputSchema>;

/** `POST|PATCH /api/reviews/:id/reply` → reviews.reply_to_review / reviews.edit_reply. */
export const ReviewReplyInputSchema = z.object({
	body: z.string().trim().min(1).max(REVIEW_REPLY_MAX),
});
export type ReviewReplyInput = z.infer<typeof ReviewReplyInputSchema>;
// #endregion

// #region What the dialog reads
/** A target's public face, as reviews.fn_target_card answers it. */
export const ReviewTargetCardSchema = z.object({
	name: z.string(),
	handle: z.string(),
	avatar: z.string().nullable().optional(),
});
export type ReviewTargetCard = z.infer<typeof ReviewTargetCardSchema>;

/** The party's review of one target on one anchor, as reviews.get_reviewables answers it. */
export const ReviewableReviewSchema = z.object({
	id: z.string().uuid(),
	rating: z.coerce.number(),
	title: z.string().nullable(),
	comment: z.string(),
	created_at: z.string(),
	edited_at: z.string().nullable(),
	withdrawn: z.boolean(),
	hidden: z.boolean(),
	reply: z.string().nullable(),
	replied_at: z.string().nullable(),
	window_closes_at: z.string(),
	mine: z.boolean(),
	/** False while it waits, blind, for the other side's review or the window's close. */
	revealed: z.boolean(),
	editable: z.boolean(),
});
export type ReviewableReview = z.infer<typeof ReviewableReviewSchema>;

/** One thing the caller may review on a project (reviews.get_reviewables). */
export const ReviewableSchema = z.object({
	anchor_kind: ReviewAnchorKindSchema,
	anchor_id: z.string().uuid(),
	target_type: ReviewTargetTypeSchema,
	target_id: z.string().uuid(),
	target: ReviewTargetCardSchema.nullable(),
	opened_at: z.string(),
	closes_at: z.string(),
	open: z.boolean(),
	review: ReviewableReviewSchema.nullable(),
});
export type Reviewable = z.infer<typeof ReviewableSchema>;

/**
 * Where one reviewable stands for its client, which is what the Overview's Reviews block and the
 * dialog branch on (and what the Dev Context Switcher's `reviewState` axis simulates):
 * `open` — nothing written yet, window open · `reviewed` — written, still editable · `locked` —
 * written, fixed (replied to, or its window closed) · `withdrawn` — the author withdrew it ·
 * `closed` — never written and the window closed.
 */
export const ReviewStateSchema = z.enum(["open", "reviewed", "locked", "withdrawn", "closed"]);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

/** A reviewable's state, derived from what get_reviewables answered. */
export function reviewStateOf(item: Reviewable): ReviewState {
	const r = item.review;
	if (!r) return item.open ? "open" : "closed";
	if (r.withdrawn) return "withdrawn";
	return r.editable ? "reviewed" : "locked";
}

/** What the viewer may do to one review on a list (reviews.get_review_actions). */
export const ReviewActionsSchema = z.object({
	id: z.string().uuid(),
	can_edit: z.boolean(),
	can_withdraw: z.boolean(),
	can_reply: z.boolean(),
	can_edit_reply: z.boolean(),
	edit_href: z.string().nullable(),
});
export type ReviewActions = z.infer<typeof ReviewActionsSchema>;

/** The viewer's actions on a review, in the app's own casing (what a review list renders). */
export const ReviewViewerSchema = z.object({
	canEdit: z.boolean(),
	canReply: z.boolean(),
	canEditReply: z.boolean(),
	editHref: z.string().nullable(),
});
export type ReviewViewer = z.infer<typeof ReviewViewerSchema>;

/** The target's public reply under a review, as a list renders it. */
export const ReviewReplySchema = z.object({
	body: z.string().max(REVIEW_REPLY_MAX),
	repliedAt: z.string(),
	dateLabel: z.string(),
	edited: z.boolean(),
});
export type ReviewReply = z.infer<typeof ReviewReplySchema>;
// #endregion

// #region Client Trust Score (Decision #486)
/** The score's bars: shown from this many reviews, and a warning below this score. */
export const CLIENT_TRUST_MIN_REVIEWS = 3;
export const CLIENT_TRUST_WARN_BELOW = 3;

/** One `reviews.client_trust_scores` row, column for column (00000019). */
export const ClientTrustScoreRowSchema = z.object({
	subject_type: z.enum(["user", "business"]),
	subject_id: z.string().uuid(),
	review_count: z.number().int().nonnegative(),
	base: z.coerce.number().min(1).max(5),
	lost_disputes: z.number().int().nonnegative(),
	deduction: z.coerce.number().min(0).max(1.5),
	score: z.coerce.number().min(1).max(5),
	computed_at: z.string(),
});
export type ClientTrustScoreRow = z.infer<typeof ClientTrustScoreRowSchema>;

/** A client party's score as a reader shows it: only from 3 reviews (reviews.fn_client_trust_shown). */
export const ClientTrustShownSchema = z.object({
	score: z.coerce.number(),
	reviewCount: z.number().int(),
	warned: z.boolean(),
});
export type ClientTrustShown = z.infer<typeof ClientTrustShownSchema>;

/** Whether a shown score warns: below 3.00 with at least 3 reviews. */
export function isClientTrustWarned(score: number, reviewCount: number): boolean {
	return reviewCount >= CLIENT_TRUST_MIN_REVIEWS && score < CLIENT_TRUST_WARN_BELOW;
}

/** What reviews.get_client_trust_warning answers about one project's client. */
export const ClientTrustWarningRowSchema = z.union([
	z.object({ warned: z.literal(false) }),
	z.object({
		warned: z.literal(true),
		score: z.coerce.number(),
		review_count: z.number().int(),
		reviews_href: z.string().nullable(),
		acknowledged: z.boolean(),
	}),
]);
export type ClientTrustWarningRow = z.infer<typeof ClientTrustWarningRowSchema>;

/** The warning in the app's casing: what the Informed Consent dialog states before Apply or Accept. */
export const ClientTrustWarningSchema = z.object({
	warned: z.boolean(),
	score: z.number().nullable(),
	reviewCount: z.number().int().nullable(),
	reviewsHref: z.string().nullable(),
	acknowledged: z.boolean(),
});
export type ClientTrustWarning = z.infer<typeof ClientTrustWarningSchema>;

/** `GET /api/reviews/client-trust?project=` and `POST` (acknowledge): the project's opaque slug. */
export const ClientTrustQuerySchema = z.object({
	project: z.string().regex(slugPattern("project")),
});
export type ClientTrustQuery = z.infer<typeof ClientTrustQuerySchema>;

/** The SQLSTATE a proposal or hire acceptance raises before the consent (Decision #486 (C)). */
export const CLIENT_TRUST_CONSENT_SQLSTATE = "PT428";
// #endregion
