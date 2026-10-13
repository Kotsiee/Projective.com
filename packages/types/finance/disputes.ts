import { z } from "zod";
import { basisPoints, currency, minorUnitsNonNeg, timestamp, uuid } from "./common.ts";

/**
 * finance disputes — the platform dispute lifecycle (Decision #212; PRODUCT_MANAGEMENT §3.8;
 * PRODUCT_SPEC §Dispute Resolution). Mirrors `finance.disputes` / `dispute_messages` /
 * `dispute_evidence` and the read `finance.get_dispute` (00001260). A card chargeback is a different
 * thing — `ChargebackSchema` in `billing.ts`.
 *
 * Every rule (who may respond, when a case escalates, what a ruling moves) is the database's; these
 * are the shapes the routes validate and the status panel renders.
 */

// #region Lifecycle
/** `dispute_status` (public enum): open → awaiting_response → under_review → a terminal ruling. */
export const DisputeStatus = z.enum([
	"open",
	"awaiting_response",
	"under_review",
	"resolved_release",
	"resolved_refund",
	"resolved_split",
]);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

/** The statuses in which a dispute still holds its escrow. */
export const LIVE_DISPUTE_STATUSES: ReadonlyArray<DisputeStatus> = [
	"open",
	"awaiting_response",
	"under_review",
];

/** Whether a dispute is still live (its escrow cannot be released). */
export function isDisputeLive(status: DisputeStatus): boolean {
	return LIVE_DISPUTE_STATUSES.includes(status);
}

/** A ruling an operator can make — `finance.resolve_dispute`'s `p_outcome`. */
export const DisputeOutcome = z.enum(["release", "refund", "split"]);
export type DisputeOutcome = z.infer<typeof DisputeOutcome>;

/** The reader's side of a case. `operator` is a platform operator (`security.is_admin()`). */
export const DisputeRole = z.enum(["claimant", "respondent", "operator"]);
export type DisputeRole = z.infer<typeof DisputeRole>;

/** Who filed a statement. */
export const DisputeParty = DisputeRole;
export type DisputeParty = DisputeRole;
// #endregion

// #region The case read
/** The attendance audit's frozen snapshot (`finance.fn_dispute_attendance_audit`). */
export const DisputeAuditSchema = z.object({
	verdict: z.enum(["pending", "refund", "dismiss", "ambiguous"]),
	presenceOutcome: z.string().nullable(),
	tracked: z.boolean(),
	hostPresencePct: z.number().int().min(0).max(100),
	claimantPresencePct: z.number().int().min(0).max(100),
	thresholdPct: z.number().int().min(0).max(100),
	auditedAt: timestamp,
});
export type DisputeAudit = z.infer<typeof DisputeAuditSchema>;

/** What a ruling moved. `deferred`: dismissed, the payment follows its normal release; `byFact`: the
 * escrow settled on another path before the ruling. */
export const DisputeSettlementSchema = z.object({
	payeeMinor: minorUnitsNonNeg,
	feeMinor: minorUnitsNonNeg,
	refundMinor: minorUnitsNonNeg,
	currency: currency.nullable(),
	deferred: z.boolean(),
	byFact: z.boolean(),
	/** Server-formatted figures (`formatMoney`); null when the currency is unknown. */
	payeeLabel: z.string().max(40).nullable(),
	feeLabel: z.string().max(40).nullable(),
	refundLabel: z.string().max(40).nullable(),
});
export type DisputeSettlement = z.infer<typeof DisputeSettlementSchema>;

/**
 * One evidence file filed with a statement. Served by the files pipeline (`/api/files/object/:id`,
 * `fileObjectHref`), which `files.fn_can_read` opens to the dispute's parties and operators.
 */
export const DisputeEvidenceFileSchema = z.object({
	id: uuid,
	name: z.string().min(1).max(500),
	mimeType: z.string().max(200),
	sizeBytes: z.number().int().min(0),
});
export type DisputeEvidenceFile = z.infer<typeof DisputeEvidenceFileSchema>;

/** One statement in the Evidence Vault. */
export const DisputeMessageSchema = z.object({
	id: uuid,
	party: DisputeParty,
	body: z.string().min(1).max(4000),
	createdAt: timestamp,
	mine: z.boolean(),
	files: z.array(DisputeEvidenceFileSchema).max(10),
});
export type DisputeMessage = z.infer<typeof DisputeMessageSchema>;

/** A dispute as its reader may see it — `finance.get_dispute`, mapped. */
export const DisputeCaseSchema = z.object({
	id: uuid,
	kind: z.enum(["no_show", "general"]),
	status: DisputeStatus,
	role: DisputeRole,
	reason: z.string().min(1).max(500),
	openedAt: timestamp,
	respondBy: timestamp.nullable(),
	respondedAt: timestamp.nullable(),
	escalatedAt: timestamp.nullable(),
	/**
	 * The review SLA: when an operator should have ruled on an `under_review` case
	 * (`dispute_review_hours` after it entered review). A target, never a ruling — a case past it only
	 * raises an ops alert. Null before review.
	 */
	reviewBy: timestamp.nullable(),
	resolvedAt: timestamp.nullable(),
	resolutionNotes: z.string().nullable(),
	resolvedByOperator: z.boolean(),
	payeeShareBp: basisPoints.nullable(),
	settlement: DisputeSettlementSchema.nullable(),
	audit: DisputeAuditSchema.nullable(),
	amountMinor: minorUnitsNonNeg,
	currency,
	/** The money at stake, server-formatted. */
	amountLabel: z.string().max(40),
	projectSlug: z.string().min(1).max(120),
	sitting: z.object({
		id: uuid,
		slug: z.string().min(1).max(40),
		title: z.string().min(1).max(200),
		startsAt: timestamp,
		endsAt: timestamp,
	}).nullable(),
	messages: z.array(DisputeMessageSchema).max(500),
	canRespond: z.boolean(),
	canEscalate: z.boolean(),
	canResolve: z.boolean(),
});
export type DisputeCase = z.infer<typeof DisputeCaseSchema>;

/** A dispute as a session workspace lists it (`get_session_workspace.disputes`). */
export const DisputeSummarySchema = z.object({
	id: uuid,
	status: DisputeStatus,
	sessionEventId: uuid.nullable(),
	respondBy: timestamp.nullable(),
	openedAt: timestamp,
	resolvedAt: timestamp.nullable(),
	/** The viewer opened it. */
	mine: z.boolean(),
});
export type DisputeSummary = z.infer<typeof DisputeSummarySchema>;
// #endregion

// #region The operator queue
/** The live statuses the operator queue lists — `finance.list_disputes_for_review`'s `p_status`. */
export const DisputeQueueStatus = z.enum(["open", "awaiting_response", "under_review"]);
export type DisputeQueueStatus = z.infer<typeof DisputeQueueStatus>;

/** A party as the queue names them: a display name and handle, either possibly absent. */
export const DisputeQueuePartySchema = z.object({
	name: z.string().max(200).nullable(),
	handle: z.string().max(60).nullable(),
});
export type DisputeQueueParty = z.infer<typeof DisputeQueuePartySchema>;

/** One live case in the operator queue — `finance.list_disputes_for_review`, mapped. */
export const DisputeQueueItemSchema = z.object({
	id: uuid,
	status: DisputeQueueStatus,
	kind: z.enum(["no_show", "general"]),
	reason: z.string().min(1).max(500),
	openedAt: timestamp,
	respondBy: timestamp.nullable(),
	escalatedAt: timestamp.nullable(),
	/** The review SLA; null unless the case is (or was) under review. */
	reviewBy: timestamp.nullable(),
	/** Under review and past `reviewBy` — the sweep has raised (or is about to raise) its ops alert. */
	overdue: z.boolean(),
	amountMinor: minorUnitsNonNeg,
	currency,
	/** The money at stake, server-formatted. */
	amountLabel: z.string().max(40),
	projectSlug: z.string().max(120),
	projectTitle: z.string().max(200),
	sitting: z.object({
		title: z.string().min(1).max(200),
		startsAt: timestamp,
		endsAt: timestamp,
	}).nullable(),
	claimant: DisputeQueuePartySchema,
	respondent: DisputeQueuePartySchema,
	statementCount: z.number().int().min(0),
	evidenceCount: z.number().int().min(0),
});
export type DisputeQueueItem = z.infer<typeof DisputeQueueItemSchema>;

/** The queue's counts over the WHOLE live set (a filtered read still names every tab). */
export const DisputeQueueCountsSchema = z.object({
	open: z.number().int().min(0),
	awaitingResponse: z.number().int().min(0),
	underReview: z.number().int().min(0),
	overdue: z.number().int().min(0),
});
export type DisputeQueueCounts = z.infer<typeof DisputeQueueCountsSchema>;

/** `GET /api/finance/disputes` — the operator queue, oldest-due first (at most 200 cases). */
export const DisputeQueueSchema = z.object({
	items: z.array(DisputeQueueItemSchema).max(200),
	counts: DisputeQueueCountsSchema,
});
export type DisputeQueue = z.infer<typeof DisputeQueueSchema>;

/** `GET /api/finance/disputes?status=` — narrow the queue to one live status; absent = every live case. */
export const DisputeQueueQuerySchema = z.object({
	status: DisputeQueueStatus.optional(),
});
export type DisputeQueueQuery = z.infer<typeof DisputeQueueQuerySchema>;

/**
 * The Dev Context Switcher's operator-desk preview (`pj.dev.operator`): `queue` renders `/admin/disputes`
 * with sample cases for a viewer who is NOT a platform operator, `empty` with none. Honoured in
 * development only; it grants nothing — every read and ruling still goes to the database, which
 * refuses a non-operator. Absent = no override.
 */
export type OperatorDeskOverride = "queue" | "empty";

/** The cookie that carries {@link OperatorDeskOverride}. */
export const OPERATOR_DESK_OVERRIDE_COOKIE = "pj.dev.operator";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parseOperatorDeskOverride(
	raw: string | null | undefined,
): OperatorDeskOverride | null {
	const v = raw?.trim();
	return v === "queue" || v === "empty" ? v : null;
}
// #endregion

// #region Inputs
/** `POST /api/finance/disputes/:id/respond` — a statement with up to ten of the caller's uploaded files. */
export const DisputeRespondInputSchema = z.object({
	statement: z.string().trim().min(1, "Write your account of what happened.").max(4000),
	fileIds: z.array(uuid).max(10).default([]),
});
export type DisputeRespondInput = z.infer<typeof DisputeRespondInputSchema>;

/** `POST /api/finance/disputes/:id/resolve` — a platform operator's ruling. */
export const DisputeResolveInputSchema = z.object({
	outcome: DisputeOutcome,
	/** The provider's share of a split, in basis points (1–9,999); only with `split`. */
	payeeShareBp: z.number().int().min(1).max(9999).nullable().default(null),
	notes: z.string().trim().min(3, "Give the parties the reasons for the ruling.").max(2000),
}).refine((v) => (v.outcome === "split") === (v.payeeShareBp !== null), {
	message: "A split names the provider's share; release and refund do not.",
	path: ["payeeShareBp"],
});
export type DisputeResolveInput = z.infer<typeof DisputeResolveInputSchema>;
// #endregion
