import { z } from "zod";
import {
	currency,
	minorUnits,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
	uuid,
} from "./common.ts";
import { WalletOwnerType } from "./ledger.ts";

/**
 * finance billing — invoices, invoice line items, disputes, monthly statements, and chargebacks.
 * Mirrors the EXISTING `finance.invoices`/`invoice_line_items`/`disputes` (migration 0009) plus the
 * additive `finance.statements` + `finance.chargebacks` (migration 20260723094000).
 *
 * Refunds & chargebacks are recorded as NEGATIVE-direction `finance.transactions` with canonical
 * `reason` codes (`escrow_refund`, `fair_exit_refund`, `refund`, `chargeback`); {@link ChargebackSchema}
 * tracks the Stripe dispute case those lines reference.
 */

// #region Invoices (existing)
/** Per-payout vs consolidated monthly billing. */
export const InvoiceType = z.enum(["per_stage", "consolidated_monthly"]);
export type InvoiceType = z.infer<typeof InvoiceType>;

/** `finance.invoices.status`. */
export const InvoiceStatus = z.enum(["draft", "issued", "paid", "overdue", "void"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

/** A row of `finance.invoices`. */
export const InvoiceSchema = z.object({
	id: uuid,
	projectStageId: uuid.nullable(),
	issueToBusinessId: uuid,
	issueFromProfile: uuid,
	invoiceType: InvoiceType,
	billingPeriodStart: timestamp.nullable(),
	billingPeriodEnd: timestamp.nullable(),
	amountCents: minorUnitsPositive,
	subtotalCents: minorUnitsNonNeg,
	platformFeeCents: minorUnitsNonNeg,
	taxCents: minorUnitsNonNeg,
	totalCents: minorUnitsNonNeg,
	currency,
	status: InvoiceStatus,
	dueDate: timestamp.nullable(),
	paidAt: timestamp.nullable(),
	pdfFileId: uuid.nullable(),
	createdAt: timestamp,
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** A row of `finance.invoice_line_items`. */
export const InvoiceLineItemSchema = z.object({
	id: uuid,
	invoiceId: uuid,
	refType: z.enum(["escrow", "bonus", "platform_fee", "refund", "tax"]),
	refId: uuid.nullable(),
	description: z.string().max(400),
	amountCents: minorUnits,
	currency,
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;
// #endregion

// #region Disputes (existing)
/** `dispute_status` (public enum). */
export const DisputeStatus = z.enum(["open", "under_review", "resolved", "refunded"]);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

/** A row of `finance.disputes` — a contested escrow (funds sit in the Dispute Lockbox while open). */
export const DisputeSchema = z.object({
	id: uuid,
	escrowId: uuid,
	openedByProfile: uuid,
	reason: z.string().min(1),
	status: DisputeStatus,
	resolutionNotes: z.string().nullable(),
	createdAt: timestamp,
	resolvedAt: timestamp.nullable(),
});
export type Dispute = z.infer<typeof DisputeSchema>;
// #endregion

// #region Statements (additive)
/** `finance.statement_status`. */
export const StatementStatus = z.enum(["draft", "issued", "final"]);
export type StatementStatus = z.infer<typeof StatementStatus>;

/**
 * A row of `finance.statements` — the monthly consolidated statement (30-day window, issued on the
 * 1st). Complements per-payout {@link InvoiceSchema} billing lines.
 */
export const StatementSchema = z.object({
	id: uuid,
	ownerType: WalletOwnerType,
	ownerId: uuid,
	periodStart: timestamp,
	periodEnd: timestamp,
	currency,
	openingBalanceCents: minorUnits,
	closingBalanceCents: minorUnits,
	totalInCents: minorUnitsNonNeg,
	totalOutCents: minorUnitsNonNeg,
	totalFeesCents: minorUnitsNonNeg,
	status: StatementStatus,
	pdfFileId: uuid.nullable(),
	issuedAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type Statement = z.infer<typeof StatementSchema>;
// #endregion

// #region Chargebacks (additive)
/** `finance.chargeback_status`. */
export const ChargebackStatus = z.enum(["opened", "under_review", "won", "lost", "refunded"]);
export type ChargebackStatus = z.infer<typeof ChargebackStatus>;

/** A row of `finance.chargebacks` — a Stripe dispute the negative ledger line references. */
export const ChargebackSchema = z.object({
	id: uuid,
	walletId: uuid.nullable(),
	transactionId: uuid.nullable(),
	escrowId: uuid.nullable(),
	/** Stripe dispute id (placeholder XXXX-XXXX in docs). */
	providerRef: z.string().max(200).nullable(),
	amountCents: minorUnitsPositive,
	currency,
	status: ChargebackStatus,
	reason: z.string().max(400).nullable(),
	openedAt: timestamp,
	resolvedAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type Chargeback = z.infer<typeof ChargebackSchema>;
// #endregion

// #region Idempotency (system table — backend-only)
/**
 * A row of `finance.idempotency_keys` — the retry-safety record every money-mutating operation
 * presents so a replay returns the stored result instead of re-executing. Definer/service-only in the
 * DB (never crosses the client boundary); the shape is the SSOT for the backend money services.
 */
export const IdempotencyKeySchema = z.object({
	key: z.string().min(1).max(200),
	scope: z.string().min(1).max(120),
	requestHash: z.string().max(200),
	status: z.enum(["in_progress", "succeeded", "failed"]),
	response: z.record(z.string(), z.unknown()).nullable(),
	createdAt: timestamp,
	expiresAt: timestamp.nullable(),
});
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
// #endregion
