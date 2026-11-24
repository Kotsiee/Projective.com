import { z } from "zod";
import { SubmissionStatus } from "./submissions.ts";
import { EngagementKind } from "./summary.ts";
import { STAGE_SLUG_RE } from "./rows.ts";

/**
 * projects.settlement — the Zod SSOT for the client decisions that move deliverables and money:
 * reviewing one submission, approving a stage (releasing its escrow), cancelling a stage under the
 * Fair Exit split, and cancelling an engagement of any kind (`projects.cancel_project`).
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
 * Remove a stage from the setup form — `DELETE /api/projects/:id/stages/:stageId`, through
 * `projects.delete_stage`, which deletes a pristine stage and refuses a touched one (PROJECTS ST2).
 * Unlike {@link StageRef} this takes the `stg-…` slug only: a new route, so no uuid caller to keep
 * (Decision #88).
 */
export const DeleteStageSchema = z.object({
	projectId: ProjectRef,
	stageId: z.string().regex(STAGE_SLUG_RE),
});
export type DeleteStage = z.infer<typeof DeleteStageSchema>;

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

// #region Cancelling an engagement (Decisions #456, #467)
/**
 * Cancel an engagement of any kind — a client's brief or a bought service — through
 * `projects.cancel_project`, the one settle-first door (Decision #467). `tiers` names the Fair Exit
 * share for every stage holding claimed work, keyed by the stage's uuid as the preview lists it; an
 * unclaimed ticket and a later-stage reservation go back whole and need none.
 */
export const CancelProjectSchema = z.object({
	projectId: ProjectRef,
	tiers: z.record(z.string().uuid(), FairExitTier).default({}),
	reason: z.string().trim().max(400).optional(),
});
export type CancelProject = z.infer<typeof CancelProjectSchema>;

/** Read what cancelling an engagement settles. The address is the whole request. */
export const PreviewProjectCancelSchema = z.object({ projectId: ProjectRef });
export type PreviewProjectCancel = z.infer<typeof PreviewProjectCancelSchema>;

/** One tier's settlement of one stage's claimed tickets — `projects.fn_fair_exit_quote_scoped`. */
export const ProjectExitQuoteSchema = z.object({
	tier: FairExitTier,
	ticketCount: z.number().int().min(0),
	freelancerPaidCents: z.number().int().min(0),
	feeCents: z.number().int().min(0),
	clientRefundedCents: z.number().int().min(0),
});
export type ProjectExitQuote = z.infer<typeof ProjectExitQuoteSchema>;

/** A stage holding claimed work: the client picks its tier from these three quotes. */
export const ProjectCancelStageSchema = z.object({
	stageId: z.string().uuid(),
	stageName: z.string().min(1).max(200),
	tiers: z.array(ProjectExitQuoteSchema).length(3),
});
export type ProjectCancelStage = z.infer<typeof ProjectCancelStageSchema>;

/**
 * Why an engagement cannot be cancelled now (`projects.fn_project_cancel_blocked`): it has `ended`;
 * a `dispute` stands against money it holds (the ruling settles that money, never the cancel); it
 * holds a session's per-`sittings` escrow, which settles through each sitting; or a stage holding
 * claimed work is mid-payment (`settling`).
 */
export const ProjectCancelBlocked = z.enum(["ended", "dispute", "sittings", "settling"]);
export type ProjectCancelBlocked = z.infer<typeof ProjectCancelBlocked>;

/**
 * The cancellation's read (`projects.preview_project_cancel`): `returnedCents` comes back to the client
 * whatever is chosen, and each listed stage settles at the tier picked for it. `kind` words the dialog
 * (a brief is a project, a bought engagement a service).
 */
export const ProjectCancelPreviewSchema = z.object({
	kind: EngagementKind,
	currency: z.string().length(3),
	cancellable: z.boolean(),
	blocked: ProjectCancelBlocked.nullable(),
	returnedCents: z.number().int().min(0),
	ticketsToCancel: z.number().int().min(0),
	stages: z.array(ProjectCancelStageSchema).max(60),
});
export type ProjectCancelPreview = z.infer<typeof ProjectCancelPreviewSchema>;

/** What the cancellation moved: the provider's Fair Exit pay, the fee on it, and everything refunded. */
export const ProjectCancelledSchema = z.object({
	status: z.literal("cancelled"),
	kind: EngagementKind,
	currency: z.string().length(3),
	freelancerPaidCents: z.number().int().min(0),
	feeCents: z.number().int().min(0),
	clientRefundedCents: z.number().int().min(0),
	ticketsCancelled: z.number().int().min(0),
});
export type ProjectCancelled = z.infer<typeof ProjectCancelledSchema>;
// #endregion

// #region Completing and reopening an engagement (EX1, Decision #546)
/**
 * Complete an engagement through `projects.complete_project`, the client's door. Nothing may be held
 * or reserved; the tickets still open (none funded) and the stages still open close, then the
 * engagement reads `completed` and its reviews open. An engagement whose last money settles completes
 * on its own (`projects.fn_complete_project`), so this door is for one with unfunded work left over.
 */
export const CompleteProjectSchema = z.object({
	projectId: ProjectRef,
	reason: z.string().trim().max(400).optional(),
});
export type CompleteProject = z.infer<typeof CompleteProjectSchema>;

/** Read what completing an engagement closes. The address is the whole request. */
export const PreviewProjectCompleteSchema = z.object({ projectId: ProjectRef });
export type PreviewProjectComplete = z.infer<typeof PreviewProjectCompleteSchema>;

/**
 * Why an engagement cannot be completed now (`projects.fn_project_complete_blocked`): it has `ended`;
 * it is a `draft`; it is a session engagement (`sessions`), whose seats complete on their own; one of
 * the cancel's reasons (`dispute`, `sittings`, `settling`); or money is still `held` or reserved, which
 * settles first (approve the stage, or cancel).
 */
export const ProjectCompleteBlocked = z.enum([
	"ended",
	"draft",
	"sessions",
	"dispute",
	"sittings",
	"settling",
	"held",
]);
export type ProjectCompleteBlocked = z.infer<typeof ProjectCompleteBlocked>;

/** The completion's read (`projects.preview_project_complete`): what closes, or why it cannot. */
export const ProjectCompletePreviewSchema = z.object({
	kind: EngagementKind,
	completable: z.boolean(),
	blocked: ProjectCompleteBlocked.nullable(),
	/** Open tickets (none funded) that close as `cancelled`. */
	ticketsToClose: z.number().int().min(0),
	/** Open stages that close: `paid` when work on them was paid, else `cancelled`. */
	stagesToClose: z.number().int().min(0),
});
export type ProjectCompletePreview = z.infer<typeof ProjectCompletePreviewSchema>;

/** What completing closed. */
export const ProjectCompletedSchema = z.object({
	status: z.literal("completed"),
	kind: EngagementKind,
	ticketsClosed: z.number().int().min(0),
	stagesClosed: z.number().int().min(0),
});
export type ProjectCompleted = z.infer<typeof ProjectCompletedSchema>;

/**
 * Reopen a completed engagement to extend it (`projects.reopen_project`; PRODUCT_SPEC §Extension
 * Logic): `completed → active`, the client's, recorded in the status history. A completed engagement
 * takes no new escrow, so extending it starts here.
 */
export const ReopenProjectSchema = z.object({
	projectId: ProjectRef,
	reason: z.string().trim().max(400).optional(),
});
export type ReopenProject = z.infer<typeof ReopenProjectSchema>;

/** The reopened engagement's new state. */
export const ProjectReopenedSchema = z.object({
	status: z.literal("active"),
	kind: EngagementKind,
});
export type ProjectReopened = z.infer<typeof ProjectReopenedSchema>;
// #endregion
