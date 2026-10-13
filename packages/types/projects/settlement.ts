import { z } from "zod";
import { SubmissionStatus } from "./submissions.ts";

/**
 * projects.settlement — the Zod SSOT for the three client decisions that move deliverables and money:
 * reviewing one submission, approving a stage (releasing its escrow), and cancelling a stage under
 * the Fair Exit split.
 *
 * Each maps onto exactly one guarded Postgres door — `projects.review_submission`,
 * `projects.approve_stage`, `projects.cancel_stage_fair_exit` — and each of those checks review
 * authority (`projects.can_review_project`) itself. Nothing here grants anything: the payloads say
 * what was asked for, and the database decides whether the caller may ask it.
 *
 * The vocabulary is the DATABASE's, not a parallel one. `review_submission` accepts `accept` and
 * `request_revision`, and a Fair Exit is chosen as a percentage tier from `{25, 50, 75}` — the
 * function converts that to basis points itself (`finance-model.md` §3). Restating either in another
 * shape here would add a mapping layer whose only possible output is a mismatch.
 */

// #region Addressing
/**
 * A project address as the API routes carry it — the `prj-…` slug (Decision #88). Bounded like every
 * other `projectId` in this package.
 */
const ProjectRef = z.string().min(1).max(120);

/**
 * A stage address — its `stg-…` slug (Decision #93) or its uuid. Both are accepted because the
 * submissions read projects a unit's `stageId` as the stage's uuid while every routed surface carries
 * the slug; the service resolves either one INSIDE the named project, so a stage of another
 * engagement cannot be addressed through this one's URL.
 */
const StageRef = z.string().min(1).max(80);
// #endregion

// #region Submission review
/** The two verdicts `projects.review_submission` accepts. */
export const SubmissionReviewDecision = z.enum(["accept", "request_revision"]);
export type SubmissionReviewDecision = z.infer<typeof SubmissionReviewDecision>;

/**
 * One reviewer verdict on one submission.
 *
 * `notes` lands in `stage_submissions.feedback->>'global'` — the one feedback key the schema relies
 * on (it becomes the `stage_revision_requests.reason` a revision raises), and the one the
 * submissions read projects back as the unit's note. A revision request REQUIRES notes: a freelancer
 * sent back with no reason has nothing to act on, which is the same rule the review modal enforces
 * before it enables the control.
 */
export const ReviewSubmissionSchema = z
	.object({
		projectId: ProjectRef,
		stageId: StageRef,
		submissionId: z.string().min(1).max(120),
		decision: SubmissionReviewDecision,
		notes: z.string().max(4000).default(""),
	})
	.refine((v) => v.decision !== "request_revision" || v.notes.trim().length > 0, {
		message: "Say what needs to change before requesting a revision.",
		path: ["notes"],
	});
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>;

/**
 * What a recorded verdict answers with — the submission's new review state.
 *
 * An acceptance settles the ticket and releases its held escrow in the same transaction (Decision
 * #194); `releasedCount` is how many escrows that release paid out — 0 for a revision request, an
 * unfunded ticket, or the stub path, which moves no money.
 */
export const SubmissionReviewedSchema = z.object({
	submissionId: z.string().min(1).max(120),
	stageId: z.string().min(1).max(80),
	status: SubmissionStatus,
	releasedCount: z.number().int().min(0),
});
export type SubmissionReviewed = z.infer<typeof SubmissionReviewedSchema>;

/**
 * Raise a PAID revision round on a submission once its stage's free rounds are used (Decision #167),
 * through `projects.request_paid_revision`. Nothing is charged: the round waits `awaiting_payment` until
 * its `paid_revision` basket line is paid, and only then is the work sent back. Notes are required for
 * the reason a free round requires them.
 */
export const RequestPaidRevisionSchema = z.object({
	projectId: ProjectRef,
	stageId: StageRef,
	submissionId: z.string().min(1).max(120),
	notes: z.string().trim().min(1, "Say what needs to change before buying a revision.").max(4000),
});
export type RequestPaidRevision = z.infer<typeof RequestPaidRevisionSchema>;

/** The raised round — what the Buy Now line names (`itemType: "paid_revision"`, `itemId: revisionId`). */
export const PaidRevisionRaisedSchema = z.object({
	revisionId: z.string().uuid(),
	priceMinor: z.number().int().positive(),
	currency: z.string().length(3),
	title: z.string().min(1).max(200),
});
export type PaidRevisionRaised = z.infer<typeof PaidRevisionRaisedSchema>;
// #endregion

// #region Stage approval
/** Approve a stage and release every escrow still held on it. The address is the whole payload. */
export const ApproveStageSchema = z.object({
	projectId: ProjectRef,
	stageId: StageRef,
});
export type ApproveStage = z.infer<typeof ApproveStageSchema>;

/**
 * The settlement `projects.approve_stage` reports.
 *
 * `status` is `paid`, not `approved`: the function releases the escrow and settles the stage in one
 * transaction, so there is no intermediate approved-but-unpaid state to report. The counts and sums
 * cover only what THIS approval released: a ticket an earlier acceptance paid is not in them, so a
 * stage every acceptance already paid out settles with `releasedCount` 0. `refundedCount` /
 * `refundedCents` are prepaid tickets nobody claimed (Decision #197): they go back to the payer and
 * keep their status — approval never completes a ticket it has nobody to pay (Decision #213).
 * `handoverUnlocked` is true when this was the project's last unsettled stage and the Contact
 * Handover fired.
 */
export const StageApprovedSchema = z.object({
	stageId: z.string().min(1).max(80),
	status: z.literal("paid"),
	releasedCount: z.number().int().min(0),
	totalPaidCents: z.number().int().min(0),
	feeCents: z.number().int().min(0),
	refundedCount: z.number().int().min(0),
	refundedCents: z.number().int().min(0),
	handoverUnlocked: z.boolean(),
});
export type StageApproved = z.infer<typeof StageApprovedSchema>;
// #endregion

// #region Fair Exit
/** The settlement tiers `projects.cancel_stage_fair_exit` accepts — the freelancer's share, in percent. */
export const FairExitTier = z.union([z.literal(25), z.literal(50), z.literal(75)]);
export type FairExitTier = z.infer<typeof FairExitTier>;

/** Cancel a stage under the Fair Exit split at the client-selected tier (`finance-model.md` §3). */
export const CancelStageFairExitSchema = z.object({
	projectId: ProjectRef,
	stageId: StageRef,
	tier: FairExitTier,
});
export type CancelStageFairExit = z.infer<typeof CancelStageFairExitSchema>;

/**
 * The settlement a Fair Exit reports: what the freelancer was paid and what the client got back.
 *
 * The figures are the door's own quote (`projects.fn_fair_exit_quote`), taken under the ticket locks
 * the split then settles, so they are exactly what moved — the same arithmetic the preview showed.
 * `cancelledCount` is the tickets whose escrow the split settled; `ticketsCancelled` is the tickets
 * left on the stage that closed as `cancelled` (Decision #198). The stub path moves nothing and reports
 * zeros.
 */
export const StageExitedSchema = z.object({
	stageId: z.string().min(1).max(80),
	status: z.literal("cancelled"),
	tier: FairExitTier,
	cancelledCount: z.number().int().min(0),
	ticketsCancelled: z.number().int().min(0),
	freelancerPaidCents: z.number().int().min(0),
	feeCents: z.number().int().min(0),
	clientRefundedCents: z.number().int().min(0),
	currency: z.string().length(3),
});
export type StageExited = z.infer<typeof StageExitedSchema>;

/** Read the Fair Exit preview for a stage. The address is the whole request. */
export const PreviewStageFairExitSchema = z.object({
	projectId: ProjectRef,
	stageId: StageRef,
});
export type PreviewStageFairExit = z.infer<typeof PreviewStageFairExitSchema>;

/**
 * What one tier would settle — `projects.fn_fair_exit_quote`, the same figures the door reports.
 *
 * Minor units for the record, plus labels the server formats, so the confirmation renders money and
 * never computes it. `clientRefundedCents` includes `prepaidCents`: a ticket prepaid but never claimed
 * earned nothing and goes back whole at every tier (Decision #197).
 */
export const FairExitQuoteSchema = z.object({
	tier: FairExitTier,
	ticketCount: z.number().int().min(0),
	freelancerPaidCents: z.number().int().min(0),
	feeCents: z.number().int().min(0),
	clientRefundedCents: z.number().int().min(0),
	freelancerPaidLabel: z.string().max(40),
	feeLabel: z.string().max(40),
	clientRefundedLabel: z.string().max(40),
});
export type FairExitQuote = z.infer<typeof FairExitQuoteSchema>;

/** Why a stage cannot be ended under Fair Exit — the two states `cancel_stage_fair_exit` refuses. */
export const FairExitBlocked = z.enum(["settled", "nothing_held"]);
export type FairExitBlocked = z.infer<typeof FairExitBlocked>;

/**
 * The Fair Exit confirmation's read (`projects.preview_stage_fair_exit`, Decision #198): one quote per
 * tier, in tier order, and what else ending the stage does. `exitable` is false, with `blocked` set,
 * when the door would refuse; the island then offers no confirm.
 */
export const FairExitPreviewSchema = z.object({
	stageId: z.string().min(1).max(80),
	stageName: z.string().min(1).max(200),
	currency: z.string().length(3),
	exitable: z.boolean(),
	blocked: FairExitBlocked.nullable(),
	heldCents: z.number().int().min(0),
	heldLabel: z.string().max(40),
	prepaidCents: z.number().int().min(0),
	prepaidLabel: z.string().max(40),
	/** Tickets still standing on the stage that the exit closes as `cancelled`. */
	ticketsToCancel: z.number().int().min(0),
	tiers: z.array(FairExitQuoteSchema).length(3),
});
export type FairExitPreview = z.infer<typeof FairExitPreviewSchema>;
// #endregion
