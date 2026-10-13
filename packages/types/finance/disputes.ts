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

/** One evidence file filed with a statement (served through `/api/disputes/:id/evidence/:fileId`). */
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

// #region Inputs
/** `POST /api/disputes/:id/respond` — a statement with up to ten of the caller's uploaded files. */
export const DisputeRespondInputSchema = z.object({
	statement: z.string().trim().min(1, "Write your account of what happened.").max(4000),
	fileIds: z.array(uuid).max(10).default([]),
});
export type DisputeRespondInput = z.infer<typeof DisputeRespondInputSchema>;

/** `POST /api/disputes/:id/resolve` — a platform operator's ruling. */
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
