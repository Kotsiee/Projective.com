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
/** One line of a room's log, as the audit froze it. A party alone: a case names no third person. */
export const DisputeRoomEntrySchema = z.object({
	party: z.enum(["host", "claimant", "other"]),
	action: z.enum(["joined", "left", "waiting", "join_click"]),
	at: timestamp,
	/** Known only by an email a provider reported, which is weaker evidence (Decision #343, C4 (b)). */
	weak: z.boolean(),
});
export type DisputeRoomEntry = z.infer<typeof DisputeRoomEntrySchema>;

/** The attendance audit's frozen snapshot (`finance.fn_dispute_attendance_audit`). */
export const DisputeAuditSchema = z.object({
	verdict: z.enum(["pending", "refund", "dismiss", "ambiguous"]),
	presenceOutcome: z.string().nullable(),
	tracked: z.boolean(),
	hostPresencePct: z.number().int().min(0).max(100),
	claimantPresencePct: z.number().int().min(0).max(100),
	/** Time actually in the room, not first join to last leave (Decision #383 (b)). */
	hostSeconds: z.number().int().min(0),
	claimantSeconds: z.number().int().min(0),
	reconnects: z.number().int().min(0),
	thresholdPct: z.number().int().min(0).max(100),
	auditedAt: timestamp,
	timeline: z.array(DisputeRoomEntrySchema).max(200),
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
 * One evidence file filed with a statement. Served by the media proxy (`/api/media/proxy/:id`,
 * `mediaProxyHref`), which `files.fn_can_read` opens to the dispute's parties and operators.
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

/**
 * The custom quote a disputed engagement was bought on (Decision #522): the terms both parties agreed,
 * the SHA-256 reference they agreed under, whether the stored terms still hash to it, and when the
 * offer was accepted and paid for.
 */
export const DisputeAgreedTermsSchema = z.object({
	offerId: uuid,
	scope: z.string().max(4000),
	deliverables: z.array(z.string().max(160)).max(12),
	priceLabel: z.string().max(40),
	turnaroundDays: z.number().int().min(1).max(90),
	termsHash: z.string().regex(/^[0-9a-f]{64}$/),
	intact: z.boolean(),
	acceptedAt: timestamp.nullable(),
	paidAt: timestamp.nullable(),
});
export type DisputeAgreedTerms = z.infer<typeof DisputeAgreedTermsSchema>;

/**
 * What a dispute contests: a no-show claim on a seat's sitting, any other engagement escrow, a
 * digital product line whose sale is still clearing (`product`, FBP DB21), or a ticket's money on one
 * stage (`ticket`, PROJECTS EX2).
 */
export const DisputeKind = z.enum(["no_show", "general", "product", "ticket"]);
export type DisputeKind = z.infer<typeof DisputeKind>;

/** A ticket case's two sides (PROJECTS EX2): the client's (`payer`) and the freelancer's (`payee`). */
export const TicketDisputeSide = z.enum(["payer", "payee"]);
export type TicketDisputeSide = z.infer<typeof TicketDisputeSide>;

/**
 * Where a ticket case's money stands: still `held` in escrow while the work waits for a verdict, or
 * released and frozen in its 7-day clearing window (`pending`, Decision #548 ruling 1).
 */
export const TicketDisputeWindow = z.enum(["held", "pending"]);
export type TicketDisputeWindow = z.infer<typeof TicketDisputeWindow>;

/** The ticket a ticket case is about, and what an offer's preview needs (`finance.get_dispute.ticket`). */
export const DisputeTicketSchema = z.object({
	id: uuid,
	slug: z.string().min(1).max(40),
	title: z.string().min(1).max(300),
	stageId: uuid,
	stageName: z.string().max(200),
	claimantSide: TicketDisputeSide,
	window: TicketDisputeWindow,
	/** The payer's platform fee rate, so a share's preview mirrors the settlement. */
	feeBp: basisPoints,
	/** Each contested escrow's principal, in minor units. */
	escrowAmounts: z.array(minorUnitsNonNeg).min(1).max(20),
});
export type DisputeTicket = z.infer<typeof DisputeTicketSchema>;

/**
 * One Phase-1 offer on a ticket case (Decision #548 ruling 3): the freelancer's share in basis points
 * (0 = all back to the client, 10000 = all to the freelancer) and what it would move. The newest offer
 * on a live case is the standing one, and only the other side may accept it.
 */
export const DisputeOfferSchema = z.object({
	id: uuid,
	party: z.enum(["claimant", "respondent"]),
	payeeShareBp: z.number().int().min(0).max(10000),
	note: z.string().max(1000).nullable(),
	createdAt: timestamp,
	acceptedAt: timestamp.nullable(),
	mine: z.boolean(),
	standing: z.boolean(),
	canAccept: z.boolean(),
	payeeMinor: minorUnitsNonNeg,
	feeMinor: minorUnitsNonNeg,
	refundMinor: minorUnitsNonNeg,
});
export type DisputeOffer = z.infer<typeof DisputeOfferSchema>;

/** What a share moves: the freelancer's payout, the fee on that share, the rest back to the client. */
export interface DisputeOfferSplit {
	payeeMinor: number;
	feeMinor: number;
	refundMinor: number;
}

/**
 * The TS mirror of `finance.fn_dispute_offer_split` over `fn_fair_exit_split` (00001260, 00001200):
 * per escrow, the share is `amount × bp / 10000` floored, the fee `share × feeBp / 10000` floored, the
 * payout the share less its fee, and the rest of the principal goes back. Summed over the escrows.
 * Pinned by `disputes.test.ts`; the probe `ticket_dispute.sql` pins the SQL side.
 */
export function disputeOfferSplit(
	escrowAmounts: readonly number[],
	payeeShareBp: number,
	feeBp: number,
): DisputeOfferSplit {
	const bp = Math.min(10000, Math.max(0, Math.trunc(payeeShareBp)));
	return escrowAmounts.reduce<DisputeOfferSplit>((sum, amount) => {
		const share = Math.floor((amount * bp) / 10000);
		const fee = Math.floor((share * feeBp) / 10000);
		return {
			payeeMinor: sum.payeeMinor + Math.max(share - fee, 0),
			feeMinor: sum.feeMinor + fee,
			refundMinor: sum.refundMinor + Math.max(amount - share, 0),
		};
	}, { payeeMinor: 0, feeMinor: 0, refundMinor: 0 });
}

/** How a share settles: all to the freelancer is a release, none a refund, anything between a split. */
export function offerOutcome(payeeShareBp: number): "release" | "refund" | "split" {
	return payeeShareBp >= 10000 ? "release" : payeeShareBp <= 0 ? "refund" : "split";
}

/** The side a role on a ticket case is, given which side raised it. */
export function ticketDisputeSideOf(
	role: "claimant" | "respondent",
	claimantSide: TicketDisputeSide,
): TicketDisputeSide {
	return role === "claimant" ? claimantSide : claimantSide === "payer" ? "payee" : "payer";
}

/** A side's name on a ticket case. */
export function ticketDisputeSideLabel(side: TicketDisputeSide): string {
	return side === "payer" ? "The client" : "The freelancer";
}

/** An Evidence Vault's state: `pending` until the service has copied its files, then `ready`. */
export const DisputeVaultStatus = z.enum(["pending", "ready"]);
export type DisputeVaultStatus = z.infer<typeof DisputeVaultStatus>;

/**
 * A ticket case's Evidence Vault as the case read names it (`finance.get_dispute.vault`, PROJECTS EX3):
 * the snapshot frozen as the case was raised, and the SHA-256 of its canonical manifest. The manifest
 * itself is `finance.get_dispute_vault`'s.
 */
export const DisputeVaultSchema = z.object({
	status: DisputeVaultStatus,
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	createdAt: timestamp,
});
export type DisputeVault = z.infer<typeof DisputeVaultSchema>;

/**
 * A vault as its reader may see it (`finance.get_dispute_vault`): the parties read the manifest and its
 * hash; an operator reads the raw snapshot with where its bytes are (`objectPrefix`, null to a party).
 */
export const DisputeVaultReadSchema = DisputeVaultSchema.extend({
	disputeId: uuid,
	role: DisputeRole,
	/** The canonical manifest the hash is over: terms, escrows, history, submissions and rooms at raise. */
	manifest: z.record(z.string(), z.unknown()),
	objectPrefix: z.string().max(80).nullable(),
});
export type DisputeVaultRead = z.infer<typeof DisputeVaultReadSchema>;

/** Where a case's summary PDF downloads (PROJECTS EX3): its parties and operators only. */
export function disputeSummaryHref(disputeId: string): string {
	return `/api/finance/disputes/${encodeURIComponent(disputeId)}/summary.pdf`;
}

/** Where a case's Evidence Vault reads as JSON: the manifest for a party, the raw snapshot for an operator. */
export function disputeVaultHref(disputeId: string): string {
	return `/api/finance/disputes/${encodeURIComponent(disputeId)}/vault`;
}

/** A vault's state and hash as MetaLine facts: what it holds, and the hash's short form. */
export function disputeVaultFacts(vault: DisputeVault): { state: string; reference: string } {
	return {
		state: vault.status === "ready" ? "Evidence Vault sealed" : "Evidence Vault copying files",
		// A non-breaking hyphen: the name never splits across lines on a phone.
		reference: `SHA\u2011256 ${vault.sha256.slice(0, 12)}`,
	};
}

/** A dispute as its reader may see it — `finance.get_dispute`, mapped. */
export const DisputeCaseSchema = z.object({
	id: uuid,
	kind: DisputeKind,
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
	/**
	 * Who could reach the sitting's room, for an operator's eyes only (Decision #392): null to a party
	 * and on a case with no room. Read live, because a provider's record can land after the audit.
	 */
	room: z.object({
		/** The provider confirmed that holding the link was not enough to get in. */
		guarded: z.boolean(),
		/** People in the room who matched no seat (`scheduling.fn_room_unmatched`). */
		unmatched: z.number().int().min(0),
	}).nullable(),
	amountMinor: minorUnitsNonNeg,
	currency,
	/** The money at stake, server-formatted. */
	amountLabel: z.string().max(40),
	/** The engagement's project; empty on a product dispute, which has none. */
	projectSlug: z.string().max(120),
	/** The purchase a product dispute is about (FBP DB21); null on any other. */
	purchaseTitle: z.string().max(200).nullable(),
	sitting: z.object({
		id: uuid,
		slug: z.string().min(1).max(40),
		title: z.string().min(1).max(200),
		startsAt: timestamp,
		endsAt: timestamp,
	}).nullable(),
	messages: z.array(DisputeMessageSchema).max(500),
	/** The custom quote the engagement was bought on, or `null` (Decision #522). */
	agreedTerms: DisputeAgreedTermsSchema.nullable().optional(),
	/** A ticket case's ticket (PROJECTS EX2); null on any other. */
	ticket: DisputeTicketSchema.nullable().optional(),
	/** A ticket case's offers, oldest first; empty on any other. */
	offers: z.array(DisputeOfferSchema).max(200).optional(),
	/** A ticket case's Evidence Vault (PROJECTS EX3); null on any other. */
	vault: DisputeVaultSchema.nullable().optional(),
	canRespond: z.boolean(),
	canEscalate: z.boolean(),
	/** The caller may make an offer (a party, on a live ticket case). */
	canOffer: z.boolean().optional(),
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
	kind: DisputeKind,
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
	/** The purchase a product dispute is about (FBP DB21); null on any other. */
	purchaseTitle: z.string().max(200).nullable(),
	/** The ticket a ticket case is about (PROJECTS EX2); null on any other. */
	ticketTitle: z.string().max(300).nullable().optional(),
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

/** Why a buyer reports a downloaded product (FBP DB21): its files didn't arrive whole, or are faulty. */
export const OrderProblemReason = z.enum(["not_delivered", "defective"]);
export type OrderProblemReason = z.infer<typeof OrderProblemReason>;

/**
 * `POST /api/checkout/orders/[entitlement]/problem` — a buyer's report on a downloaded digital product
 * while its sale clears (`finance.open_order_line_dispute`, FBP DB21), with up to ten of their files.
 */
export const ReportOrderProblemInputSchema = z.object({
	reason: OrderProblemReason,
	statement: z.string().trim().min(1, "Say what went wrong.").max(4000),
	fileIds: z.array(uuid).max(10).default([]),
});
export type ReportOrderProblemInput = z.infer<typeof ReportOrderProblemInputSchema>;

/**
 * `POST /api/finance/disputes` — either side raises a dispute on a ticket's money on one stage
 * (`finance.open_ticket_dispute`, PROJECTS EX2), with up to ten of their own uploaded files.
 */
export const OpenTicketDisputeInputSchema = z.object({
	ticketId: uuid,
	stageId: uuid,
	reason: z.string().trim().min(3, "Say what is disputed.").max(200),
	statement: z.string().trim().min(1, "Give your account of what happened.").max(4000),
	fileIds: z.array(uuid).max(10).default([]),
});
export type OpenTicketDisputeInput = z.infer<typeof OpenTicketDisputeInputSchema>;

/** `POST /api/finance/disputes/:id/offers` — offer the freelancer's share of the money, 0–100 %. */
export const DisputeOfferInputSchema = z.object({
	payeeShareBp: z.number().int().min(0).max(10000),
	note: z.string().trim().max(1000).optional(),
});
export type DisputeOfferInput = z.infer<typeof DisputeOfferInputSchema>;

/**
 * `GET /api/finance/disputes/ticket/:ticketId` — a ticket's dispute state for its reader
 * (`finance.ticket_dispute_state`): the live case, if any, and whether the caller may raise one now on
 * the ticket's current stage. 404 for anyone who is neither side.
 */
export const TicketDisputeStateSchema = z.object({
	side: TicketDisputeSide,
	disputeId: uuid.nullable(),
	status: DisputeStatus.nullable(),
	stageId: uuid.nullable(),
	canRaise: z.boolean(),
	window: TicketDisputeWindow.nullable(),
});
export type TicketDisputeState = z.infer<typeof TicketDisputeStateSchema>;

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
