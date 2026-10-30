import { z } from "zod";
import { FileCategory } from "../files/categories.ts";
import {
	StageAssignmentMode,
	TicketPriority,
	TicketStatus,
	TicketUnitPriceCents,
	TicketWorkloadIntensity,
} from "./board.ts";
import { IpOwnershipMode } from "./create.ts";
import { StageAssignmentStatus, StageCapacity } from "./setup.ts";

/**
 * projects rows — the Zod mirror of the four delivery tables in `00000015_tables_projects.sql`:
 * `projects.project_stages`, `projects.tickets`, `projects.stage_assignments` and
 * `projects.stage_submissions` (PROJECT_MANAGEMENT_COMPLETENESS audit §5.5, PM-WP10). The board,
 * setup and submission view models are projections over these rows.
 *
 * Row shapes assert only what the table asserts: a column with no CHECK is a plain value here, and a
 * CHECK is spelled the same way on both sides. `projects-tables.contract.test.ts` holds every schema
 * to the migration, column for key.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
/** A non-negative price in minor units (the stage price CHECKs). */
const priceCents = z.number().int().min(0);
// #endregion

// #region Enums (mirror the Postgres enum types)
/**
 * `stage_status`: a stage's own lifecycle. Today only `open`, `assigned`, `in_progress`, `cancelled`
 * and `paid` are written; `submitted`, `approved` and `revisions` have no writer yet (audit X19).
 */
export const StageStatus = z.enum([
	"open",
	"assigned",
	"in_progress",
	"submitted",
	"approved",
	"revisions",
	"paid",
	"cancelled",
]);
export type StageStatus = z.infer<typeof StageStatus>;

/** `start_trigger_type`: what starts a stage's clock. */
export const StageStartTrigger = z.enum([
	"fixed_date",
	"on_project_start",
	"on_hire_confirmed",
	"dependent_on_stage",
]);
export type StageStartTrigger = z.infer<typeof StageStartTrigger>;

/** `project_stages.file_duration_mode` (its column CHECK). */
export const StageFileDurationMode = z.enum(["fixed_deadline", "relative_duration", "no_due_date"]);
export type StageFileDurationMode = z.infer<typeof StageFileDurationMode>;

/** `payment_status`: a ticket's escrow state. A refund writes `unpaid`; `refunded` has no writer. */
export const TicketPaymentStatus = z.enum([
	"unpaid",
	"needs_funding",
	"escrow_funded",
	"partially_released",
	"released",
	"refunded",
]);
export type TicketPaymentStatus = z.infer<typeof TicketPaymentStatus>;

/** `assignment_type`: who holds a seat, a freelancer or a team. */
export const StageAssigneeType = z.enum(["freelancer", "team"]);
export type StageAssigneeType = z.infer<typeof StageAssigneeType>;

/**
 * `stage_submissions.status` as STORED (`stage_submissions_status_check`). The view model's
 * `SubmissionStatus` says `revision_requested` for the stored `revisions_requested`, through one
 * mapper (PRODUCT_MANAGEMENT §3.7).
 */
export const StoredSubmissionStatus = z.enum([
	"draft",
	"pending_review",
	"accepted",
	"revisions_requested",
]);
export type StoredSubmissionStatus = z.infer<typeof StoredSubmissionStatus>;
// #endregion

// #region projects.project_stages
/** A stage's opaque route slug (`ck_project_stages_slug_shape`, Decision #88). */
export const STAGE_SLUG_RE = /^stg-[23456789abcdefghjkmnopqrstuvwxyz]{10}$/;
/** A ticket's opaque route slug (`ck_tickets_slug_shape`, Decision #88). */
export const TICKET_SLUG_RE = /^tkt-[23456789abcdefghjkmnopqrstuvwxyz]{10}$/;

/**
 * A row of `projects.project_stages`. `capacity` and `seatCount` are one fact stated twice: a
 * `limited` stage has a count and an `unlimited` one has none (`ck_project_stages_seat_count`). Stage
 * order is the execution sequence, one stage per `sortOrder` within a project.
 */
export const ProjectStageRowSchema = z
	.object({
		id: uuid,
		projectId: uuid,
		name: z.string(),
		slug: z.string().regex(STAGE_SLUG_RE),
		/** The rich-text brief; {@link descriptionText} is its flattened search text. */
		description: z.unknown(),
		descriptionText: z.string(),
		sortOrder: z.number().int(),
		status: StageStatus,
		fileUploadRequired: z.boolean(),
		allowedFileKinds: z.array(z.string()),
		defaultTasks: z.unknown(),
		skills: z.array(z.string()).nullable(),
		seatLimit: z.number().int().positive().nullable(),
		parallel: z.boolean(),
		ndaOverride: z.boolean(),
		allowedFileCategories: z.array(FileCategory).nullable(),
		allowedFileExtensions: z.array(z.string()),
		unitPriceCents: priceCents.nullable(),
		milestone: z.string(),
		startTriggerType: StageStartTrigger,
		fixedStartDate: timestamp.nullable(),
		startDependencyStageId: uuid.nullable(),
		startDependencyLagDays: z.number().int().nullable(),
		hireTriggerActive: z.boolean(),
		fileRevisionsAllowed: z.number().int().min(0).nullable(),
		extraRevisionPriceCents: priceCents.nullable(),
		revisionsUsed: z.number().int().min(0),
		fileDurationMode: StageFileDurationMode.nullable(),
		fileDurationDays: z.number().int().nullable(),
		fileDueDate: timestamp.nullable(),
		sessionDurationMinutes: z.number().int().nullable(),
		sessionCount: z.number().int().nullable(),
		sessionPreferredDays: z.array(z.string()).nullable(),
		sessionEndDate: timestamp.nullable(),
		ipOwnershipOverride: IpOwnershipMode.nullable(),
		ndaRequired: z.boolean().nullable(),
		createdAt: timestamp,
		completedAt: timestamp.nullable(),
		archivedAt: timestamp.nullable(),
		ipMode: IpOwnershipMode.nullable(),
		assignmentMode: StageAssignmentMode,
		/** The stage's hard cap on summed Workload Intensity; `null` is uncapped. */
		maxConcurrentIntensity: z.number().nullable(),
		chainReaction: z.boolean(),
		capacity: StageCapacity,
		seatCount: z.number().int().min(1).max(99).nullable(),
	})
	.refine((row) => (row.capacity === "limited") === (row.seatCount !== null), {
		message: "A limited stage has a seat count, and an unlimited one has none.",
		path: ["seatCount"],
	});
export type ProjectStageRow = z.infer<typeof ProjectStageRowSchema>;
// #endregion

// #region projects.tickets
/**
 * A row of `projects.tickets`. `workloadIntensity` is the stored $W_i$, the RESULT of category weight
 * × difficulty multiplier and the figure `projects.check_ticket_capacity` sums: a number, strictly
 * positive, not the {@link TicketIntensity} enum the composer offers. `unitPriceCents` `null` inherits
 * the stage price.
 */
export const TicketRowSchema = z.object({
	id: uuid,
	projectId: uuid,
	currentStageId: uuid.nullable(),
	currentAssigneeId: uuid.nullable(),
	slug: z.string().regex(TICKET_SLUG_RE),
	ownerUserId: uuid.nullable(),
	title: z.string(),
	/** The rich-text body; {@link textDescription} is its flattened search text. */
	description: z.unknown(),
	textDescription: z.string(),
	status: TicketStatus,
	priority: TicketPriority,
	attachmentCount: z.number().int(),
	/** `[{ stage_id, order }]`. */
	requiredStages: z.unknown(),
	tasks: z.unknown(),
	dueDate: timestamp.nullable(),
	workloadIntensity: TicketWorkloadIntensity,
	paymentStatus: TicketPaymentStatus,
	unitPriceCents: TicketUnitPriceCents,
	totalAmountPaid: z.number().int().min(0),
	/** Manual order, honoured only in the backlog lane. */
	sortOrder: z.number().int().nullable(),
	claimedAt: timestamp.nullable(),
	hiddenUntil: timestamp.nullable(),
	/** The open workload report suspending this ticket. */
	workloadReportId: uuid.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type TicketRow = z.infer<typeof TicketRowSchema>;
// #endregion

// #region projects.stage_assignments
/**
 * A row of `projects.stage_assignments`: one seat on a stage, held by a freelancer or a team. A taken
 * seat is never deleted nor returned to `declined` / `pending_funding`.
 */
export const StageAssignmentRowSchema = z.object({
	id: uuid,
	projectStageId: uuid,
	assigneeType: StageAssigneeType,
	freelancerProfileId: uuid.nullable(),
	teamId: uuid.nullable(),
	assignedBy: uuid,
	isClientManaged: z.boolean(),
	status: StageAssignmentStatus,
	createdAt: timestamp,
});
export type StageAssignmentRow = z.infer<typeof StageAssignmentRowSchema>;
// #endregion

// #region projects.stage_submissions
/**
 * A row of `projects.stage_submissions`: one reviewable delivery against a ticket in a stage.
 * `number` is the per-stage ordinal ("Submission 3"); `revisionOf` points at the submission it redoes.
 */
export const StageSubmissionRowSchema = z.object({
	id: uuid,
	projectStageId: uuid,
	ticketId: uuid,
	submittedBy: uuid,
	notes: z.string().nullable(),
	createdAt: timestamp,
	title: z.string(),
	status: StoredSubmissionStatus,
	description: z.unknown(),
	checkedItemIds: z.unknown(),
	number: z.number().int().nullable(),
	reviewedBy: uuid.nullable(),
	reviewedAt: timestamp.nullable(),
	feedback: z.unknown().nullable(),
	revisionOf: uuid.nullable(),
	updatedAt: timestamp,
});
export type StageSubmissionRow = z.infer<typeof StageSubmissionRowSchema>;
// #endregion
