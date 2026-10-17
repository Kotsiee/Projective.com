import { z } from "zod";
import { SpendRefTable } from "./vault.ts";

/**
 * The business spend gate (BUSINESSES_AUDIT BF19, BF21, BF22): `finance.fn_assert_business_spend`
 * refuses a door that would move a business's pooled money — the basket, a transfer out, funding a
 * stage, ticket or paid revision, the card escrow lock — when the business is not KYB-verified, the
 * spend is over the ACTING member's envelope, or it is at or above the vault's approval threshold
 * (with the platform fallback) and no approval for it can be redeemed. The database is the authority;
 * these are the shapes the API and the islands share for its refusals. An escrow hold with no human
 * funder (a claim, the Chain Reaction, the auto-fund drain) reports the same reasons as a PF402
 * needs-funding refusal instead (`details.reason` on that envelope).
 */

// #region Refusal
/** The reason key: the database MESSAGE's prefix and `details.reason` on the envelope. */
export const SpendGateReason = z.enum(["kyb_required", "over_limit", "needs_approval"]);
export type SpendGateReason = z.infer<typeof SpendGateReason>;

/** The SQLSTATE each reason is raised with: KYB is a verification refusal, the rest spend authority. */
export const SPEND_GATE_SQLSTATE: Record<SpendGateReason, "PK403" | "PA403"> = {
	kyb_required: "PK403",
	over_limit: "PA403",
	needs_approval: "PA403",
};

/** The sentence a funder reads for each reason. */
export const SPEND_GATE_REFUSAL: Record<SpendGateReason, string> = {
	kyb_required: "Complete business verification (KYB) before spending from this account.",
	over_limit: "This is over your spending limit for this account — ask an approver to sign it off.",
	needs_approval:
		"This spend is at or above the account's approval threshold and needs an approver's sign-off.",
};

/**
 * What an approval request for a refused spend must bind to: the spend-approval refs
 * ({@link SpendRefTable}) a money door names — an invoice is paid through its own door, not the gate.
 */
export const SpendGateRefTable = SpendRefTable.exclude(["invoices"]);
export type SpendGateRefTable = z.infer<typeof SpendGateRefTable>;

/**
 * `details` of a spend-gate refusal: the reason, and — for `over_limit` / `needs_approval` — the spend
 * a request would be filed against (`refTable` / `refId`) and the vault's threshold, all `null` when
 * the database did not say.
 */
export const SpendGateDetailsSchema = z.object({
	reason: SpendGateReason,
	walletId: z.string().uuid().nullable(),
	refTable: SpendGateRefTable.nullable(),
	refId: z.string().uuid().nullable(),
	amountMinor: z.number().int().nonnegative().nullable(),
	thresholdMinor: z.number().int().nonnegative().nullable(),
});
export type SpendGateDetails = z.infer<typeof SpendGateDetailsSchema>;
// #endregion
