import { z } from "zod";
import { currency, uuid } from "./common.ts";
import { BuyerChargeSchema, CheckoutPayInSchema } from "./checkout.ts";
import { MoneyViewSchema } from "./wallet.ts";

/**
 * finance funding-charge — what funding a stage or a paid revision round charges the payer, in their
 * own currency when it differs from the project's (Decision #436, extending #435's checkout to the
 * board's Fund stage and the review's Buy a revision).
 */

// #region Charge
/**
 * The charge a funding dialog states before the payer confirms. `charge` is the exact figure: the
 * escrow's own amount (`listed`), or with a quote its price in the payer's billing currency; `payIn`
 * says which and why, exactly as the checkout's does. The quote on `charge` is the wallet route's
 * (`funding`, executed by `finance.fund_with_conversion`); a card is charged on {@link cardQuoteId}
 * (`escrow_lock`, executed when `finance.settle_card_payment` settles it), locked in the same read at
 * the same figures, because each door executes only its own purpose.
 */
export const FundingChargeSchema = z.object({
	charge: BuyerChargeSchema,
	/** The stage's or round's own amount, in the project's currency: what the escrow holds. */
	listed: MoneyViewSchema,
	payIn: CheckoutPayInSchema,
	/** The paying wallet's Available in the charge's currency: the wallet route is offered against it. */
	walletAvailableMinor: z.number().int(),
	/** The card route's quote at the same figures; `null` when nothing converts. */
	cardQuoteId: uuid.nullable(),
});
export type FundingCharge = z.infer<typeof FundingChargeSchema>;

/** `GET …/paid-revision/quote`: the round to price, and the currency its payer chose to pay in. */
export const PaidRevisionQuoteQuerySchema = z.object({
	projectId: z.string().min(1).max(120),
	stageId: z.string().min(1).max(120),
	submissionId: uuid,
	revisionId: uuid,
	payIn: currency.optional(),
});
export type PaidRevisionQuoteQuery = z.infer<typeof PaidRevisionQuoteQuerySchema>;
// #endregion
