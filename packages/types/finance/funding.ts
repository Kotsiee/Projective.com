import { z } from "zod";
import { currency, minorUnitsNonNeg, uuid } from "./common.ts";
import { EscrowLockStatus, InboundPaymentStatus } from "./payments.ts";

/**
 * finance funding — the per-ticket payment & work-start state (`PRODUCT_MANAGEMENT.md` §3.6,
 * Decisions #165–#167): is the money held, and may work start?
 *
 * Derived ONCE, by `deriveFundingState` (`@server/services/finance/funding-state.ts`), and shipped on
 * every read model that shows a ticket, a stage or a project — so the board card, the overview and
 * the payment poll cannot disagree about one ticket. Islands render it; they never derive it.
 */

// #region State
/** The §3.6 machine, one member per state. `failed` is retryable; `released` / `refunded` are terminal per escrow. */
export const FundingState = z.enum([
	"draft",
	"needs_funding",
	"processing",
	"funded",
	"in_progress",
	"in_review",
	"released",
	"failed",
	"refunded",
]);
export type FundingState = z.infer<typeof FundingState>;

/** What unlocks the next state — the one act a surface offers (or `none` when nobody can act). */
export const FundingNextAction = z.enum([
	"describe",
	"set_price",
	"fund",
	"await_payment",
	"retry_payment",
	"start_work",
	"submit",
	"review",
	"none",
]);
export type FundingNextAction = z.infer<typeof FundingNextAction>;

/** One ticket's funding status. Every figure is server-formatted so SSR and the island agree. */
export const FundingStatusSchema = z.object({
	state: FundingState,
	/** The amount the escrow holds (or would hold); `null` while nothing is priced. */
	amountMinor: minorUnitsNonNeg.nullable(),
	currency,
	/** `amountMinor` pre-formatted ("$450.00"); `null` with it. */
	amountLabel: z.string().max(24).nullable(),
	/** Whether the payee may start work now — true only in `funded`. */
	canStart: z.boolean(),
	nextAction: FundingNextAction,
	/** Why the state is what it is, in a sentence a reader can act on; `null` when the state says it all. */
	reason: z.string().max(200).nullable(),
	/** The held escrow was funded by the From-wallet auto-fund queue, not by a person. */
	autoFunded: z.boolean().optional(),
	/**
	 * When the business's monthly invoice will list this ticket's released escrow ("Nov 1"); `null` for
	 * an individual, a business settling per transaction, or an escrow not yet released or already invoiced.
	 */
	invoiceOn: z.string().max(24).nullable().optional(),
});
export type FundingStatus = z.infer<typeof FundingStatusSchema>;

/** A stage's or a project's roll-up: the most urgent ticket state, summed over the tickets in it. */
export const FundingRollupSchema = FundingStatusSchema.extend({
	/** How many tickets are in {@link FundingStatusSchema.state}. */
	tickets: z.number().int().min(0),
});
export type FundingRollup = z.infer<typeof FundingRollupSchema>;
// #endregion

// #region Card payment poll
/** `GET /api/finance/payments/[id]/status` — where one pending card payment stands, as a funding state. */
export const PaymentFundingPollSchema = z.object({
	paymentId: uuid,
	status: InboundPaymentStatus,
	lockStatus: EscrowLockStatus,
	funding: FundingStatusSchema,
});
export type PaymentFundingPoll = z.infer<typeof PaymentFundingPollSchema>;
// #endregion
