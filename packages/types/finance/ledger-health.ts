import { z } from "zod";
import { currency, minorUnits, minorUnitsNonNeg, timestamp, uuid } from "./common.ts";

/**
 * finance ledger health: the conservation identity and the open drift, for operators (FBP DB16;
 * Decision #337, ruling M2 (A)). Mirrors `finance.get_ledger_health()` (00001200 "Conservation
 * identity"), the operator-only read behind `/admin/ledger`'s Conservation and Wallet drift sections,
 * over `finance.v_conservation_identity` and `finance.v_wallet_drift` (00003004). The database computes
 * every figure; these are the shapes the service maps the jsonb onto.
 */

// #region Sections
/**
 * The `/admin/ledger` sections, in page order. Each is one `LedgerHealthService` read; `alerts` is
 * MR4's (Decision #461), `aml_signals` LG7's (Decision #529), and MR3, MR5 and MR8b each add theirs
 * here (FINANCE_BUILD_PROMPTS.md §0).
 */
export const LedgerSectionId = z.enum([
	"conservation",
	"drift",
	"escrow_age",
	"alerts",
	"aml_signals",
]);
export type LedgerSectionId = z.infer<typeof LedgerSectionId>;
// #endregion

// #region Conservation
/**
 * One currency's identity: Σ in − Σ out (`externalMinor`) against Σ held + Σ fees − Σ losses
 * (`accountedMinor`). `imbalanceMinor` is accounted − external: 0 while every movement went through a
 * door, above 0 when the platform accounts for money nobody paid in, below 0 when money left unexplained.
 */
export const ConservationCurrencySchema = z.object({
	currency,
	inCashMinor: minorUnitsNonNeg,
	inOnAccountMinor: minorUnitsNonNeg,
	inFxMinor: minorUnitsNonNeg,
	outPayoutsMinor: minorUnitsNonNeg,
	outCardRefundsMinor: minorUnitsNonNeg,
	outChargebacksMinor: minorUnitsNonNeg,
	outInvoicesMinor: minorUnitsNonNeg,
	outFxMinor: minorUnitsNonNeg,
	heldWalletsMinor: minorUnitsNonNeg,
	heldEscrowsMinor: minorUnitsNonNeg,
	heldPendingMinor: minorUnitsNonNeg,
	feesEscrowsMinor: minorUnitsNonNeg,
	feesOrdersMinor: minorUnitsNonNeg,
	feesFxMinor: minorUnitsNonNeg,
	lossesChargebacksMinor: minorUnitsNonNeg,
	lossesCardRefundsMinor: minorUnitsNonNeg,
	/** The platform-funded share of promo codes (`losses_promos_minor`, Decision #485 (a)). */
	lossesPromosMinor: minorUnitsNonNeg,
	externalMinor: minorUnits,
	accountedMinor: minorUnits,
	imbalanceMinor: minorUnits,
});
export type ConservationCurrency = z.infer<typeof ConservationCurrencySchema>;

/** One currency in one nightly check (`ops.log_entries`, scope `finance.conservation`). */
export const ConservationNightSchema = z.object({
	runId: z.string(),
	checkedAt: timestamp,
	currency,
	balanced: z.boolean(),
	externalMinor: minorUnits,
	accountedMinor: minorUnits,
	imbalanceMinor: minorUnits,
});
export type ConservationNight = z.infer<typeof ConservationNightSchema>;

/** The Conservation section: the identity now, and the checks of the last 30 nights, newest first. */
export const LedgerConservationSchema = z.object({
	asOf: timestamp,
	currencies: z.array(ConservationCurrencySchema),
	nights: z.array(ConservationNightSchema),
});
export type LedgerConservation = z.infer<typeof LedgerConservationSchema>;
// #endregion

// #region Drift
/** A wallet whose cached balance, ledger sum, newest running balance or pots disagree. */
export const WalletDriftSchema = z.object({
	walletId: uuid,
	ownerType: z.string(),
	currency,
	balanceMinor: minorUnits,
	ledgerSumMinor: minorUnits,
	latestBalanceAfterMinor: minorUnits.nullable(),
	earmarkedMinor: minorUnits,
	potDriftMinor: minorUnits,
});
export type WalletDrift = z.infer<typeof WalletDriftSchema>;

/** An FX conversion (or an unwound escrow) whose ledger legs do not add up (Decision #435). */
export const ConversionDriftSchema = z.object({
	conversionId: uuid.nullable(),
	escrowId: uuid.nullable(),
	kind: z.string(),
	problem: z.string(),
	expectedMinor: minorUnits,
	ledgerMinor: minorUnits,
});
export type ConversionDrift = z.infer<typeof ConversionDriftSchema>;

/** The Wallet drift section: what is open now, and what the nightly reconciliation logged in 30 days. */
export const LedgerDriftSchema = z.object({
	asOf: timestamp,
	wallets: z.array(WalletDriftSchema),
	conversions: z.array(ConversionDriftSchema),
	logged30d: z.number().int().min(0),
	lastLoggedAt: timestamp.nullable(),
});
export type LedgerDrift = z.infer<typeof LedgerDriftSchema>;

/** `finance.get_ledger_health()`: both sections in one read. */
export const LedgerHealthSchema = z.object({
	conservation: LedgerConservationSchema,
	drift: LedgerDriftSchema,
});
export type LedgerHealth = z.infer<typeof LedgerHealthSchema>;
// #endregion
