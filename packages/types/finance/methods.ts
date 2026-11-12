import { z } from "zod";
import {
	basisPoints,
	currency,
	FinanceOwnerType,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
	uuid,
} from "./common.ts";

/**
 * finance methods & money-movement — payment methods (spend vs earn), recurring deposits, payout
 * schedules, the Income Smoother, and wallet pots (earmarks). Mirrors migration 20260723092000.
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
	ownerType: FinanceOwnerType,
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
/**
 * `finance.deposit_interval`. `below_floor` is a floor top-up: it runs each time a business wallet's
 * balance crosses below its low-balance floor, not on a calendar.
 */
export const DepositInterval = z.enum(["weekly", "monthly", "below_floor"]);
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
	/** Who authorised the standing charge; re-stamped when a member re-prices or resumes it. */
	createdBy: uuid.nullable(),
	/** Set once when the rule is archived; an archived rule never runs again. */
	archivedAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type DepositRule = z.infer<typeof DepositRuleSchema>;

/**
 * The arguments of `finance.update_deposit_rule` (FINANCE_COMPLETENESS_AUDIT A13): pause or resume
 * (`active`), re-price (`amountCents`), or archive for good (`archive`, alone). The wallet, currency,
 * card and interval never change — a different one is a new rule.
 */
export const UpdateDepositRuleSchema = z.object({
	ruleId: uuid,
	active: z.boolean().optional(),
	amountCents: minorUnitsPositive.optional(),
	archive: z.boolean().optional(),
}).refine((v) => !v.archive || (v.active !== true && v.amountCents === undefined), {
	message: "Archiving a recurring deposit changes nothing else",
	path: ["archive"],
});
export type UpdateDepositRule = z.infer<typeof UpdateDepositRuleSchema>;
// #endregion

// #region Payout schedules
/** `finance.payout_mode` — how earnings leave the platform. */
export const PayoutMode = z.enum(["manual", "scheduled_weekly", "scheduled_monthly", "threshold"]);
export type PayoutMode = z.infer<typeof PayoutMode>;

/**
 * A row of `finance.payout_schedules`: an owner's standing withdrawal in one currency, written only by
 * `finance.save_payout_schedule` and run by `finance.fn_claim_due_payout_schedules` as `createdBy`.
 * `nextRunAt` is a weekly or monthly schedule's next slot (00:00 UTC); `failureCount` counts refusals
 * in a row, and the third sets `active` false. `instant` is reserved: Instant Payouts are Planned
 * (Decision #337, ruling P3).
 */
export const PayoutScheduleSchema = z.object({
	id: uuid,
	ownerType: FinanceOwnerType,
	ownerId: uuid,
	mode: PayoutMode,
	destinationMethodId: uuid.nullable(),
	thresholdCents: minorUnitsPositive.nullable(),
	currency,
	nextRunAt: timestamp.nullable(),
	instant: z.boolean(),
	active: z.boolean(),
	createdAt: timestamp,
	createdBy: uuid.nullable(),
	lastRunAt: timestamp.nullable(),
	lastError: z.string().max(400).nullable(),
	failureCount: z.number().int().min(0),
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

// #region Wallet pots (earmarks / tax set-aside)
/** `finance.pot_purpose`. */
export const PotPurpose = z.enum(["tax", "savings", "goal", "general"]);
export type PotPurpose = z.infer<typeof PotPurpose>;

/**
 * A row of `finance.wallet_pots` — an earmark of part of its wallet's own balance, never a
 * separate balance (Decision #337, ruling M6): the wallet may spend its balance minus its active
 * pots. `autoAllocateBp > 0` earmarks that share of each matured income credit (the tax-pot
 * auto-set-aside), and a wallet's active pots take at most 10000 together. An empty pot is archived
 * (`active: false`, `archivedAt`), never deleted. Written only by `finance.save_wallet_pot` and
 * `finance.move_pot_funds`.
 */
export const WalletPotSchema = z.object({
	id: uuid,
	walletId: uuid,
	purpose: PotPurpose,
	name: z.string().min(1).max(120),
	balanceCents: minorUnitsNonNeg,
	currency,
	autoAllocateBp: basisPoints,
	/** What the owner is saving towards; `null` is no target. It never caps the pot. */
	goalCents: minorUnitsPositive.nullable(),
	active: z.boolean(),
	archivedAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type WalletPot = z.infer<typeof WalletPotSchema>;

/** Which way a `finance.pot_movements` row moves a pot's earmark. */
export const PotMovementDirection = z.enum(["in", "out"]);
export type PotMovementDirection = z.infer<typeof PotMovementDirection>;

/**
 * Why a pot's earmark changed: `allocation` (matured income, keyed to its ledger credit),
 * `move_in` / `move_out` (`finance.move_pot_funds`, by its author) and `recovery` (a chargeback
 * or refund debit took earmarked money, keyed to that debit).
 */
export const PotMovementReason = z.enum(["allocation", "move_in", "move_out", "recovery"]);
export type PotMovementReason = z.infer<typeof PotMovementReason>;

/**
 * A row of `finance.pot_movements` — a pot's append-only ledger. An earmark moves no money
 * between wallets: Σ in − Σ out over a pot's rows is its balance, and `balanceAfterCents` is that
 * balance after the row.
 */
export const PotMovementSchema = z.object({
	id: uuid,
	potId: uuid,
	walletId: uuid,
	direction: PotMovementDirection,
	amountCents: minorUnitsPositive,
	currency,
	reason: PotMovementReason,
	refTable: z.string().max(40).nullable(),
	refId: uuid.nullable(),
	balanceAfterCents: minorUnitsNonNeg,
	actorUserId: uuid.nullable(),
	createdAt: timestamp,
});
export type PotMovement = z.infer<typeof PotMovementSchema>;
// #endregion
