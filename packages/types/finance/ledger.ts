import { z } from "zod";
import {
	basisPoints,
	currency,
	FundState,
	minorUnits,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
	uuid,
} from "./common.ts";

/**
 * finance ledger — wallets, the transaction ledger, escrows, team payout splits, and the FX rate
 * table. Mirrors `finance.wallets`/`transactions`/`escrows`/`payout_splits` (migration 0009) plus the
 * additive `finance.fx_rates` + FX snapshot columns (migration 20260723090000).
 *
 * ⚠️ The wallet balance is MATERIALISED (`balanceCents`), maintained by the ledger writers alongside
 * `transactions.balanceAfterCents` — a per-wallet single-entry running ledger, not derived
 * double-entry. The three-state {@link WalletBalances} figure is a projection over this ledger +
 * escrows + `finance.pending_releases` (finance-model.md §7). Documented, not silently "fixed".
 */

// #region Wallet
/** Which kind of entity a wallet belongs to. `organisation` is the buyer-only pooled entity (#0314). */
export const WalletOwnerType = z.enum([
	"user",
	"freelancer",
	"business",
	"team",
	"organisation",
	"system",
]);
export type WalletOwnerType = z.infer<typeof WalletOwnerType>;

/** A row of `finance.wallets`. `balanceCents` is the materialised Available balance. */
export const WalletSchema = z.object({
	id: uuid,
	ownerType: WalletOwnerType,
	ownerId: uuid,
	currency,
	balanceCents: minorUnitsNonNeg,
	createdAt: timestamp,
});
export type Wallet = z.infer<typeof WalletSchema>;
// #endregion

// #region Transaction ledger
/** Ledger movement direction. */
export const TransactionDirection = z.enum(["credit", "debit"]);
export type TransactionDirection = z.infer<typeof TransactionDirection>;

/**
 * A row of `finance.transactions` — one immutable movement on a wallet, carrying the running
 * `balanceAfterCents` and (when the movement crossed currencies) the FX snapshot captured at commit.
 * `reason` is a free-text canonical code (`escrow_hold`, `escrow_release`, `escrow_refund`,
 * `fair_exit_refund`, `team_split`, `demo_opening_credit`, `refund`, `chargeback`, …).
 */
export const TransactionSchema = z.object({
	id: uuid,
	walletId: uuid,
	direction: TransactionDirection,
	amountCents: minorUnitsPositive,
	currency,
	reason: z.string().min(1).max(80),
	refTable: z.string().max(80).nullable(),
	refId: uuid.nullable(),
	balanceAfterCents: minorUnits,
	/** FX rate applied to reach {@link fxBase}, when the movement was converted; else `null`. */
	fxRate: z.number().nullable(),
	fxBase: currency.nullable(),
	fxAsOf: timestamp.nullable(),
	createdAt: timestamp,
});
export type Transaction = z.infer<typeof TransactionSchema>;
// #endregion

// #region Escrow
/**
 * Escrow lifecycle status. The engine writes `held` on hold and `released`/`refunded` on settle;
 * `disputed` parks funds in the Dispute Lockbox; `funded` is the table default (rarely persisted, as
 * the hold path writes `held` directly). Text in the DB (not a PG enum) — this enum documents the set.
 */
export const EscrowStatus = z.enum(["funded", "held", "released", "refunded", "disputed"]);
export type EscrowStatus = z.infer<typeof EscrowStatus>;

/** Who an escrow pays out to — an individual freelancer or a team (`assignment_type`). */
export const EscrowPayeeType = z.enum(["freelancer", "team"]);
export type EscrowPayeeType = z.infer<typeof EscrowPayeeType>;

/** A row of `finance.escrows` — capital locked against a stage/ticket, plus the FX snapshot. */
export const EscrowSchema = z.object({
	id: uuid,
	projectStageId: uuid,
	ticketId: uuid.nullable(),
	payerBusinessId: uuid,
	payeeType: EscrowPayeeType,
	payeeId: uuid,
	amountCents: minorUnitsPositive,
	platformFeeCents: minorUnitsNonNeg,
	deadlineBonusCents: minorUnitsNonNeg,
	currency,
	status: z.string().max(20),
	fxRate: z.number().nullable(),
	fxBase: currency.nullable(),
	fxAsOf: timestamp.nullable(),
	createdAt: timestamp,
});
export type Escrow = z.infer<typeof EscrowSchema>;

/** A row of `finance.payout_splits` — a member's slice of a team escrow release. */
export const PayoutSplitSchema = z.object({
	id: uuid,
	escrowId: uuid,
	memberUserId: uuid,
	amountCents: minorUnits,
	currency,
	createdAt: timestamp,
});
export type PayoutSplit = z.infer<typeof PayoutSplitSchema>;

/** A row of `finance.contribution_agreements` — a team member's basis-point split share (migration 0009). */
export const ContributionAgreementSchema = z.object({
	id: uuid,
	teamId: uuid,
	memberUserId: uuid,
	percentBp: basisPoints,
});
export type ContributionAgreement = z.infer<typeof ContributionAgreementSchema>;
// #endregion

// #region FX rates + snapshot
/**
 * A row of `finance.fx_rates` — a historical FX observation. `rate` is the multiplier
 * `amount_quote = amount_base * rate`. Append-only reference data snapshotted onto committed rows.
 */
export const FxRateSchema = z.object({
	id: uuid,
	base: currency,
	quote: currency,
	rate: z.number().positive(),
	asOf: timestamp,
	provider: z.string().max(60),
	createdAt: timestamp,
});
export type FxRate = z.infer<typeof FxRateSchema>;

/** The FX snapshot captured on a transaction/escrow at commit (reproducible settlement). */
export const FxSnapshotSchema = z.object({
	fxRate: z.number().nullable(),
	fxBase: currency.nullable(),
	fxAsOf: timestamp.nullable(),
});
export type FxSnapshot = z.infer<typeof FxSnapshotSchema>;
// #endregion

// #region Balance projection (read model)
/**
 * The three-state balance projection surfaced to the finance surfaces (mirrors the
 * `org.get_business_finance` balances object): `available` = the wallet's materialised balance;
 * `locked` = capital in live escrow; `pending` = funds inside the 7-day safety window; `onHold` =
 * contested funds in the Dispute Lockbox. Derived, never stored.
 */
export const WalletBalancesSchema = z.object({
	currency,
	availableCents: minorUnits,
	lockedCents: minorUnitsNonNeg,
	pendingCents: minorUnitsNonNeg,
	onHoldCents: minorUnitsNonNeg,
	lifetimeCents: minorUnitsNonNeg,
});
export type WalletBalances = z.infer<typeof WalletBalancesSchema>;

/** A row of `finance.pending_releases` — one escrow release inside the 7-day safety window. */
export const PendingReleaseSchema = z.object({
	id: uuid,
	escrowId: uuid,
	walletId: uuid,
	amountCents: minorUnitsPositive,
	currency,
	releasedAt: timestamp,
	availableAt: timestamp,
	state: FundState,
	createdAt: timestamp,
});
export type PendingRelease = z.infer<typeof PendingReleaseSchema>;
// #endregion
