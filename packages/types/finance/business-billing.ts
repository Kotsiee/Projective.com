import { z } from "zod";
import { AutoFundMode, InvoiceStatus } from "./billing.ts";
import { InvoicingMode } from "./buyer.ts";
import { currency, uuid } from "./common.ts";

/**
 * finance business-billing — the business console's Billing module (PRODUCT_SPEC §Escrow, Wallets &
 * Finance #4): its monthly invoices with Pay, statement PDFs, invoicing terms, auto-funding and the
 * low-balance floor. Every figure is server-formatted; the island renders, it never computes money.
 */

// #region Billing period
/**
 * The billing period containing `at`: [the latest billing day on or before it, one month later), in
 * UTC. Mirrors `finance.fn_billing_period` — a NULL day is the 1st (Decision #168); days stop at 28,
 * so every month has the date.
 */
export function billingPeriod(billingDay: number | null, at: Date): { start: Date; end: Date } {
	const day = billingDay ?? 1;
	const thisMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), day));
	const start = thisMonth.getTime() > at.getTime()
		? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, day))
		: thisMonth;
	return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day)) };
}
// #endregion

// #region View
/** One consolidated invoice in the Billing module. */
export const BillingInvoiceRowSchema = z.object({
	id: uuid,
	/** "Sep 15 – Oct 15, 2026". */
	periodLabel: z.string().max(60),
	currency,
	totalLabel: z.string().max(32),
	/** What is still owed; `0` when nothing was bought on account or it is paid. */
	amountDueMinor: z.number().int().min(0),
	amountDueLabel: z.string().max(32),
	status: InvoiceStatus,
	/** "Due Oct 29" · "Overdue 3 days" · "Paid Oct 2". */
	dueLabel: z.string().max(40),
	overdue: z.boolean(),
	pdfHref: z.string().max(120),
});
export type BillingInvoiceRow = z.infer<typeof BillingInvoiceRowSchema>;

/** One wallet statement in the Billing module. */
export const BillingStatementRowSchema = z.object({
	id: uuid,
	/** "September 2026". */
	periodLabel: z.string().max(40),
	currency,
	closingLabel: z.string().max(32),
	pdfHref: z.string().max(120),
});
export type BillingStatementRow = z.infer<typeof BillingStatementRowSchema>;

/** The Billing module's projection for one business. */
export const BusinessBillingViewSchema = z.object({
	businessId: uuid,
	/** The business's default currency — the floor's and the headline balance's. */
	currency,
	invoicingMode: InvoicingMode,
	/** 1–28; `null` is the 1st. */
	billingDay: z.number().int().min(1).max(28).nullable(),
	/** Monthly invoicing and paying on account need KYB. */
	kybVerified: z.boolean(),
	autoFundMode: AutoFundMode,
	lowBalanceFloorMinor: z.number().int().positive().nullable(),
	balanceMinor: z.number().int().min(0),
	balanceLabel: z.string().max(32),
	/** The default-currency balance is under the floor right now. */
	belowFloor: z.boolean(),
	/** "Next invoice Nov 15" on monthly invoicing; `null` per transaction. */
	nextInvoiceLabel: z.string().max(60).nullable(),
	/** What is owed on account and the limit, in the default currency; `null` per transaction. */
	onAccount: z.object({ owedLabel: z.string().max(32), limitLabel: z.string().max(32) }).nullable(),
	invoices: z.array(BillingInvoiceRowSchema).max(36),
	statements: z.array(BillingStatementRowSchema).max(24),
	/** The viewer holds manage_billing — edits and Pay render only then. */
	canManage: z.boolean(),
});
export type BusinessBillingView = z.infer<typeof BusinessBillingViewSchema>;
// #endregion

// #region Inputs
/** Save the Billing module's settings — a patch; a key present is a change. */
export const UpdateBillingInputSchema = z.object({
	businessId: uuid,
	invoicingMode: InvoicingMode.optional(),
	billingDay: z.number().int().min(1).max(28).optional(),
	autoFundMode: AutoFundMode.optional(),
	/** At least one minor unit, or `null` to clear the floor. */
	lowBalanceFloorMinor: z.number().int().positive().nullable().optional(),
});
export type UpdateBillingInput = z.infer<typeof UpdateBillingInputSchema>;
// #endregion
