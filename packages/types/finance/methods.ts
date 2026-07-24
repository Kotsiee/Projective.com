import { z } from "zod";
import {
	basisPoints,
	currency,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
	uuid,
} from "./common.ts";
import { WalletOwnerType } from "./ledger.ts";

/**
 * finance methods & money-movement — payment methods (spend vs earn), recurring deposits, payout
 * schedules, the Income Smoother, and sub-wallet pots. Mirrors migration 20260723092000.
 *
 * ⚠️ Card data is Stripe-owned and NEVER stored — only an opaque `externalRef` + safe display
 * fragments (`brand`, `last4`). finance-model.md §Payment Methods / §Money-Movement Rules.
 */

// #region Payment methods
/** `finance.method_role` — a method usable for funding (spend), payout (earn), or both. */
export const MethodRole = z.enum(["funding", "payout", "both"]);
export type MethodRole = z.infer<typeof MethodRole>;

/** A row of `finance.payment_methods` — the unified funding + payout registry. */
export const PaymentMethodSchema = z.object({
	id: uuid,
	ownerType: WalletOwnerType,
	ownerId: uuid,
	methodRole: MethodRole,
	provider: z.string().max(40),
	/** Stripe PaymentMethod id (funding) / Connect external account id (payout); XXXX-XXXX in docs. */
	externalRef: z.string().max(200),
	label: z.string().max(120).nullable(),
	brand: z.string().max(40).nullable(),
	last4: z.string().max(4).nullable(),
	isDefaultFunding: z.boolean(),
	isDefaultPayout: z.boolean(),
	status: z.enum(["active", "inactive", "expired"]),
	createdAt: timestamp,
});
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
// #endregion

// #region Recurring deposits (standing instructions)
/** `finance.deposit_interval`. */
export const DepositInterval = z.enum(["weekly", "monthly"]);
export type DepositInterval = z.infer<typeof DepositInterval>;

/** A row of `finance.deposit_rules` — a standing top-up into a wallet from a funding method. */
export const DepositRuleSchema = z.object({
	id: uuid,
	walletId: uuid,
	sourceMethodId: uuid.nullable(),
	amountCents: minorUnitsPositive,
	currency,
	interval: DepositInterval,
	nextRunAt: timestamp,
	active: z.boolean(),
	failureCount: z.number().int().min(0),
	lastError: z.string().max(2000).nullable(),
	createdAt: timestamp,
});
export type DepositRule = z.infer<typeof DepositRuleSchema>;
// #endregion

// #region Payout schedules
/** `finance.payout_mode` — how earnings leave the platform. */
export const PayoutMode = z.enum(["manual", "scheduled_weekly", "scheduled_monthly", "threshold"]);
export type PayoutMode = z.infer<typeof PayoutMode>;

/** A row of `finance.payout_schedules`. `instant` opts into the Instant Payout fee (finance-model.md §1.4). */
export const PayoutScheduleSchema = z.object({
	id: uuid,
	ownerType: WalletOwnerType,
	ownerId: uuid,
	mode: PayoutMode,
	destinationMethodId: uuid.nullable(),
	thresholdCents: minorUnitsPositive.nullable(),
	currency,
	nextRunAt: timestamp.nullable(),
	instant: z.boolean(),
	active: z.boolean(),
	createdAt: timestamp,
});
export type PayoutSchedule = z.infer<typeof PayoutScheduleSchema>;
// #endregion

// #region Income Smoother
/**
 * A row of `finance.income_smoothing` — the AI-managed earnings smoother (finance-model.md §1.4).
 * `eligibilityMet` gates enrolment (≥ min-months history + min volume); `feeBp` is the ~0.5% micro-fee.
 */
export const IncomeSmoothingSchema = z.object({
	id: uuid,
	userId: uuid,
	enrolled: z.boolean(),
	targetMonthlyCents: minorUnitsNonNeg.nullable(),
	currency,
	feeBp: z.number().int().min(0),
	eligibilityMet: z.boolean(),
	enrolledAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type IncomeSmoothing = z.infer<typeof IncomeSmoothingSchema>;
// #endregion

// #region Wallet pots (sub-wallets / tax set-aside)
/** `finance.pot_purpose`. */
export const PotPurpose = z.enum(["tax", "savings", "goal", "general"]);
export type PotPurpose = z.infer<typeof PotPurpose>;

/**
 * A row of `finance.wallet_pots` — a named sub-balance carved from a wallet. `autoAllocateBp > 0`
 * skims that fraction of each inbound payout (the tax-pot auto-set-aside).
 */
export const WalletPotSchema = z.object({
	id: uuid,
	walletId: uuid,
	purpose: PotPurpose,
	name: z.string().min(1).max(120),
	balanceCents: minorUnitsNonNeg,
	currency,
	autoAllocateBp: basisPoints,
	createdAt: timestamp,
});
export type WalletPot = z.infer<typeof WalletPotSchema>;
// #endregion
