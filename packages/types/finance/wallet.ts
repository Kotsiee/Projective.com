import { z } from "zod";
import {
	basisPoints,
	currency,
	FundState,
	minorUnits,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
} from "./common.ts";
import { TransactionDirection, WalletBalancesSchema } from "./ledger.ts";
import { type ConvertedAmount, DEFAULT_LOCALE } from "./fx.ts";
import { KycStatus, VerificationTier } from "./verification.ts";
import { DepositInterval, MethodRole, PayoutMode, PotPurpose } from "./methods.ts";
import {
	ApprovalStatus,
	SpendingLimitInterval,
	SplitRuleType,
	VaultAction,
	VaultCapability,
} from "./vault.ts";
import { InvoiceStatus, StatementStatus } from "./billing.ts";
import { CardBrand } from "./card-art.ts";

/**
 * finance wallet — the READ + WRITE projection SSOT for the context-scoped Wallet & Finance surface
 * (`/wallet` + its deep pages + action modals). These are the view models the thin frontend renders and
 * the mutation payloads it posts; the row schemas in the sibling files (`ledger`/`methods`/`vault`/…)
 * remain the storage SSOT and are REUSED here, never forked.
 *
 * Money contract: every user-facing figure is a {@link MoneyView} — an integer minor-unit amount in the
 * viewer's DISPLAY currency, plus the origin `(amount, currency, rate)` when the underlying value was
 * priced in another currency. All conversion, splitting, fee and eligibility math is the fat
 * {@link WalletBackendService}'s job (finance-model.md §7/§11); the client only FORMATS a MoneyView (via
 * {@link formatMoney}) and never computes a balance, split, fee, or conversion. Amounts are minor units
 * (never floats), matching `common.ts`.
 *
 * Like the sibling domains this is a fixtures-projection today (no DB migration): the RLS-scoped
 * `finance.*` tables already model the storage; the fat service derives these view models from the
 * shared cast while `FINANCE_BACKEND_LIVE` is off. Only enum/array/object/number/string/boolean
 * primitives are used so the schema stays stable across Zod majors.
 */

// #region Money view (the display-currency projection)
/** The origin `(amount, currency)` a figure was priced in, when it differs from the display currency. */
export const MoneyOriginSchema = z.object({
	minor: minorUnits,
	currency,
	/** Pre-formatted origin label ("€1,200.00") for the hover/detail disclosure. */
	display: z.string().max(40),
	/** The FX rate applied to reach the display amount (`display = origin × rate`). */
	fxRate: z.number(),
});
export type MoneyOrigin = z.infer<typeof MoneyOriginSchema>;

/**
 * A single money figure as the viewer sees it: `minor` in `currency` (the viewer's display currency, the
 * server having already converted from origin), plus a server-formatted `display` string so SSR and the
 * island refetch render byte-identically, plus the `origin` for a cross-currency hover. The client reads
 * `display`; {@link formatMoney} reproduces it for any purely-client figure.
 */
export const MoneyViewSchema = z.object({
	minor: minorUnits,
	currency,
	display: z.string().max(40),
	origin: MoneyOriginSchema.nullable(),
});
export type MoneyView = z.infer<typeof MoneyViewSchema>;
// #endregion

// #region Scope + role vocabularies
/**
 * Which wallet the surface is scoped to. Mirrors `ContextType` (kept a local enum so the finance package
 * stays independent of `@projective/types/auth`) plus the read-only **aggregate** rollup — the personal
 * "All accounts" view summing the personal wallet and the viewer's share in each vault.
 */
export const WalletScope = z.enum(["personal", "team", "business", "organisation", "aggregate"]);
export type WalletScope = z.infer<typeof WalletScope>;

/** The three overview faces (organisation folds into the buyer-only business face). */
export const WalletVariant = z.enum(["personal", "team", "business"]);
export type WalletVariant = z.infer<typeof WalletVariant>;

/**
 * A member's coarse vault role — the capability-preset the fine-grained {@link VaultCapability} grants
 * roll up to. Owner ⊇ Admin ⊇ PM ⊇ Member. Drives the Access matrix + the capability gating of every
 * money control (the server re-checks under RLS — chrome only).
 */
export const VaultRole = z.enum(["owner", "admin", "pm", "member"]);
export type VaultRole = z.infer<typeof VaultRole>;

/**
 * The category a ledger line rolls up to for the Activity charts (distinct from the raw `reason` code).
 * A coarse, chart-friendly taxonomy.
 */
export const TxnCategory = z.enum([
	"earning",
	"payout",
	"deposit",
	"withdrawal",
	"fee",
	"refund",
	"escrow",
	"transfer",
	"spend",
]);
export type TxnCategory = z.infer<typeof TxnCategory>;

/** The action a wallet surface can launch (each a BodyPortal modal); the set is capability-gated. */
export const WalletAction = z.enum([
	"top_up",
	"withdraw",
	"transfer",
	"distribute",
	"fund_escrow",
	"new_recurring",
	"add_method",
	"set_payout",
	"request_spend",
	"enrol_smoother",
]);
export type WalletAction = z.infer<typeof WalletAction>;
// #endregion

// #region Wallet reference + switcher
/** One selectable wallet in the in-lane switcher (the active context wallet, or a membership vault). */
export const WalletRefSchema = z.object({
	scope: WalletScope,
	/** Context / entity id; `""` for the aggregate. */
	id: z.string().max(64),
	/** The entity `@handle` (drives the canonical `/@handle` link); `null` for personal/aggregate. */
	handle: z.string().max(40).nullable(),
	name: z.string().max(120),
	avatar: z.string().max(600).nullable(),
	/** The viewer's coarse role on this wallet; `null` for a personal/aggregate wallet. */
	role: VaultRole.nullable(),
	/** The headline Available balance (for the switcher row). */
	available: MoneyViewSchema,
});
export type WalletRef = z.infer<typeof WalletRefSchema>;

/** The wallet switcher: the active wallet, the selectable accounts, and the read-only aggregate rollup. */
export const WalletSwitcherSchema = z.object({
	active: WalletRefSchema,
	accounts: z.array(WalletRefSchema),
	aggregate: WalletRefSchema,
});
export type WalletSwitcher = z.infer<typeof WalletSwitcherSchema>;
// #endregion

// #region Verification / KYC gate projection
/**
 * The viewer's finance-verification state on this wallet, and what it unlocks. Drives the locked/empty
 * states (a freelancer without ID + payout setup can't earn/withdraw; a client needs nothing; a business
 * owner needs KYB to operate the vault). finance-model.md §KYC/KYB Gating.
 */
export const WalletVerificationSchema = z.object({
	subject: z.enum(["freelancer", "client", "business"]),
	kycStatus: KycStatus,
	tier: VerificationTier.nullable(),
	payoutReady: z.boolean(),
	/** Whether the earn/withdraw paths are unlocked (a freelancer's "no forever-escrow" guarantee). */
	canWithdraw: z.boolean(),
	canEarn: z.boolean(),
	/** The remaining-steps prompt shown on a locked path ("Finish verification to get paid"). */
	prompt: z.string().max(200).nullable(),
	href: z.string().max(200).nullable(),
});
export type WalletVerification = z.infer<typeof WalletVerificationSchema>;
// #endregion

// #region Money-on-the-way + flow + ledger lines
/** One "money on the way" entry — a funded escrow on an active stage, or a payout/release clearing. */
export const IncomingItemSchema = z.object({
	id: z.string().max(64),
	kind: z.enum(["escrow_funded", "pending_release", "payout", "deposit"]),
	label: z.string().max(160),
	amount: MoneyViewSchema,
	/** The fund state this money is currently in (`locked` escrow · `pending` clearing). */
	state: FundState,
	/** "Clears in 3 days" / "Funded on Helia" — the human clearing note. */
	clearingLabel: z.string().max(60),
	clearingAt: timestamp.nullable(),
	/**
	 * How far through its clearing window this money is, `0`–`1`, measured against the **server**
	 * clock. Drives the Pending state's progress-ring mark; the client never computes elapsed time
	 * (an unsynced client clock would render a dishonest ring).
	 */
	clearingFraction: z.number().min(0).max(1),
	href: z.string().max(200).nullable(),
});
export type IncomingItem = z.infer<typeof IncomingItemSchema>;

/**
 * One bucket of the in-vs-out cashflow series (a day/week/month, per range). `start` is the bucket's
 * first calendar day in the VIEWER's time zone (`YYYY-MM-DD`), so a bar labelled "5 Oct" holds exactly
 * the movements of the reader's 5 October; `netMinor` is `in − out`, summed server-side.
 */
export const FlowPointSchema = z.object({
	label: z.string().max(20),
	start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	inMinor: minorUnitsNonNeg,
	outMinor: minorUnitsNonNeg,
	netMinor: minorUnits,
});
export type FlowPoint = z.infer<typeof FlowPointSchema>;

/**
 * The family a ledger line belongs to — the Transactions page's category selector, and the analytics
 * page's volume breakdown. Finer than {@link TxnCategory} (which folds escrow releases and direct sales
 * into one "earning"), coarser than the raw `reason` code; {@link LEDGER_KIND_REASONS} is the one map
 * between the two, shared by the database filter and the label.
 */
export const LedgerKind = z.enum([
	"escrow_release",
	"escrow_hold",
	"service_sale",
	"product_sale",
	"order_payment",
	"platform_fee",
	"topup",
	"payout",
	"transfer",
	"refund",
	"other",
]);
export type LedgerKind = z.infer<typeof LedgerKind>;

/**
 * The `finance.transactions.reason` codes each {@link LedgerKind} stands for. `other` names no code: it
 * is whatever no family claims, and so cannot be filtered on.
 */
export const LEDGER_KIND_REASONS: Readonly<Record<LedgerKind, readonly string[]>> = {
	escrow_release: [
		"escrow_release",
		"escrow_release_vault_retention",
		"fair_exit_release",
		"fair_exit_release_vault_retention",
		"team_split",
		"team_finder_fee",
	],
	escrow_hold: ["escrow_hold"],
	service_sale: ["service_sale", "service_sale_vault_retention"],
	product_sale: ["product_sale", "product_sale_vault_retention"],
	order_payment: ["order_payment"],
	platform_fee: ["platform_fee", "instant_payout_fee"],
	topup: ["topup", "demo_opening_credit"],
	payout: ["payout", "payout_reversal"],
	transfer: ["transfer_in", "transfer_out", "team_distribution"],
	refund: ["refund", "escrow_refund", "fair_exit_refund", "chargeback"],
	other: [],
};

/** The family a `reason` code belongs to; an unknown code is `other`. */
export function ledgerKindOf(reason: string): LedgerKind {
	for (const kind of LedgerKind.options) {
		if (LEDGER_KIND_REASONS[kind].includes(reason)) return kind;
	}
	return "other";
}

/** Who sits on the other side of a ledger line — a person, a team or a business (`assignment_type`). */
export const LedgerPartyKind = z.enum(["user", "team", "business"]);
export type LedgerPartyKind = z.infer<typeof LedgerPartyKind>;

/** The kind of record a ledger line paid for or came from. */
export const LedgerSubjectKind = z.enum([
	"stage",
	"service",
	"product",
	"order",
	"topup",
	"payout",
	"transfer",
]);
export type LedgerSubjectKind = z.infer<typeof LedgerSubjectKind>;

/**
 * What a ledger line is ABOUT — the project stage it funded or released, the marketplace order it paid,
 * the top-up that brought it in — named as the reader may see it, with its address when it has one. A
 * record the reader may not read (a buyer's order, seen by the seller) is not named at all.
 */
export const LedgerSubjectSchema = z.object({
	kind: LedgerSubjectKind,
	/** "Helia redesign · Discovery", "Order PJ-48213", "Card top-up". */
	label: z.string().max(160),
	href: z.string().max(200).nullable(),
});
export type LedgerSubject = z.infer<typeof LedgerSubjectSchema>;

/**
 * The instrument that moved the money — a card network and its last four, the display fragment Stripe
 * returned when the card was saved. Only where the platform recorded which instrument paid (an order's
 * saved card, a recurring deposit's source); never inferred.
 */
export const LedgerInstrumentSchema = z.object({
	brand: CardBrand,
	last4: z.string().regex(/^\d{4}$/).nullable(),
});
export type LedgerInstrument = z.infer<typeof LedgerInstrumentSchema>;

/**
 * Where a line's money stands now, projected from its fund state and any open case against it:
 * `cleared` (spendable), `pending` (held in escrow or clearing its safety window), `disputed` (frozen
 * in the Dispute Lockbox or reversed by an open card dispute).
 */
export const LedgerSettlement = z.enum(["cleared", "pending", "disputed"]);
export type LedgerSettlement = z.infer<typeof LedgerSettlement>;

/**
 * A projected ledger line — one movement as the wallet surfaces it (the overview's recent list + the full
 * Transactions table). Carries the display-currency {@link MoneyView}, the fund-state badge, the chart
 * category, and the deep-link back to the Stage/Session/Invoice that produced it.
 */
export const LedgerLineSchema = z.object({
	id: z.string().max(64),
	direction: TransactionDirection,
	/** The canonical `reason` code (`escrow_release`, `team_split`, `platform_fee`, …). */
	reason: z.string().max(80),
	/** Human label ("Escrow release · Helia wallet redesign"). */
	title: z.string().max(160),
	counterparty: z.string().max(120).nullable(),
	/** The counterparty `@handle`, when it is a platform entity (canonical `/@handle` link). */
	counterpartyHandle: z.string().max(40).nullable(),
	/** What kind of entity the counterparty is; `null` when there is none the reader may see. */
	counterpartyKind: LedgerPartyKind.nullable(),
	/** The counterparty's picture through the public-media door, when they have one. */
	counterpartyAvatar: z.string().max(600).nullable(),
	amount: MoneyViewSchema,
	fundState: FundState,
	category: TxnCategory,
	/** The line's family — what the category selector filters on. */
	kind: LedgerKind,
	refKind: z.enum(["stage", "session", "invoice", "payout", "deposit", "transfer", "fee"])
		.nullable(),
	refId: z.string().max(64).nullable(),
	href: z.string().max(200).nullable(),
	/** The record this line is about, as the reader may see it. */
	subject: LedgerSubjectSchema.nullable(),
	/** The card that paid, where the platform recorded one. */
	instrument: LedgerInstrumentSchema.nullable(),
	settlement: LedgerSettlement,
	/** The invoice PDF for the stage this line settled (`/api/finance/invoices/[id]/pdf`), when one exists. */
	receiptHref: z.string().max(200).nullable(),
	at: timestamp,
	/** "Today", "Yesterday", "3 days ago", "12 Sept" — on the viewer's calendar. */
	dateLabel: z.string().max(40),
	/** The heading the ledger files the line under: "Today", "Yesterday", else its month ("September 2026"). */
	group: z.string().max(40),
});
export type LedgerLine = z.infer<typeof LedgerLineSchema>;
// #endregion

// #region Income Smoother + pots (personal extras)
/**
 * The Income Smoother state (finance-model.md §1.4). `ineligible` → a locked card with a progress meter;
 * `eligible` → the enrolment CTA; `enrolled` → the status card. `feeBp` is the ~0.5% micro-fee;
 * `monthsRequired` the 3-month history gate.
 */
export const IncomeSmootherStateSchema = z.object({
	status: z.enum(["ineligible", "eligible", "enrolled"]),
	feeBp: z.number().int().min(0),
	monthsRequired: z.number().int().min(0),
	monthsElapsed: z.number().int().min(0),
	weeksToGo: z.number().int().min(0),
	targetMonthly: MoneyViewSchema.nullable(),
	/** The projected smoothed monthly figure once enrolled. */
	projected: MoneyViewSchema.nullable(),
});
export type IncomeSmootherState = z.infer<typeof IncomeSmootherStateSchema>;

/** A named sub-wallet pot (the freelancer tax set-aside). */
export const WalletPotViewSchema = z.object({
	id: z.string().max(64),
	purpose: PotPurpose,
	name: z.string().max(120),
	balance: MoneyViewSchema,
	autoAllocateBp: basisPoints,
});
export type WalletPotView = z.infer<typeof WalletPotViewSchema>;

/** Overview extras for a personal wallet — freelancer earner cards + client spend context. */
export const PersonalExtrasSchema = z.object({
	incomeSmoother: IncomeSmootherStateSchema.nullable(),
	taxPot: WalletPotViewSchema.nullable(),
	/** Freelancer projected income from capital locked on active stages. */
	projectedFromLocked: MoneyViewSchema.nullable(),
	/** Client funding-source label ("Visa ·· 6411"). */
	fundingSource: z.string().max(120).nullable(),
	/** Client spend so far this month. */
	spentThisMonth: MoneyViewSchema.nullable(),
});
export type PersonalExtras = z.infer<typeof PersonalExtrasSchema>;
// #endregion

// #region Team split (team extras)
/** A team member's stake in the split (drives the roster + the next-payout division preview). */
export const SplitMemberSchema = z.object({
	userId: z.string().max(64),
	handle: z.string().max(40).nullable(),
	name: z.string().max(120),
	avatar: z.string().max(600).nullable(),
	stakeBp: basisPoints,
	role: VaultRole,
});
export type SplitMember = z.infer<typeof SplitMemberSchema>;

/** One member's slice of the previewed next payout. */
export const SplitShareSchema = z.object({
	name: z.string().max(120),
	handle: z.string().max(40).nullable(),
	amount: MoneyViewSchema,
	shareBp: basisPoints,
});
export type SplitShare = z.infer<typeof SplitShareSchema>;

/**
 * The active team split ruleset + a worked preview of how the NEXT payout divides (fee → vault cut →
 * template → remainder-to-vault). finance-model.md §5. `vaultBp` is the Team Vault cut taken first.
 */
export const SplitRuleViewSchema = z.object({
	ruleType: SplitRuleType,
	label: z.string().max(60),
	vaultBp: basisPoints,
	finderHandle: z.string().max(40).nullable(),
	finderBp: basisPoints.nullable(),
	previewGross: MoneyViewSchema.nullable(),
	previewFee: MoneyViewSchema.nullable(),
	previewVault: MoneyViewSchema.nullable(),
	previewShares: z.array(SplitShareSchema).max(24),
});
export type SplitRuleView = z.infer<typeof SplitRuleViewSchema>;

/** Overview extras for a team vault. */
export const TeamExtrasSchema = z.object({
	splitRule: SplitRuleViewSchema,
	members: z.array(SplitMemberSchema),
	vaultBalance: MoneyViewSchema,
});
export type TeamExtras = z.infer<typeof TeamExtrasSchema>;
// #endregion

// #region Budget + caps (business extras)
/** One point of the budget burn-down (planned vs actual cumulative spend). */
export const BurnPointSchema = z.object({
	label: z.string().max(20),
	plannedMinor: minorUnitsNonNeg,
	actualMinor: minorUnitsNonNeg,
});
export type BurnPoint = z.infer<typeof BurnPointSchema>;

/** A business budget + its burn-down series (the business overview's primary chart). */
export const BudgetBurnSchema = z.object({
	label: z.string().max(80),
	budget: MoneyViewSchema,
	spent: MoneyViewSchema,
	remaining: MoneyViewSchema,
	utilizationBp: basisPoints,
	points: z.array(BurnPointSchema).max(60),
});
export type BudgetBurn = z.infer<typeof BudgetBurnSchema>;

/** A per-member spending cap + its utilization (drives the caps bars + the Access matrix). */
export const SpendingCapViewSchema = z.object({
	id: z.string().max(64),
	memberName: z.string().max(120),
	memberHandle: z.string().max(40).nullable(),
	avatar: z.string().max(600).nullable(),
	/** `null` when the envelope has no ceiling (a NULL `cap_cents`) — never a cap of zero. */
	cap: MoneyViewSchema.nullable(),
	spent: MoneyViewSchema,
	interval: SpendingLimitInterval,
	utilizationBp: basisPoints,
	resetsLabel: z.string().max(40).nullable(),
});
export type SpendingCapView = z.infer<typeof SpendingCapViewSchema>;

/**
 * An assigned stage waiting for its escrow — what "Fund escrow" can fund. The amount is the stage's
 * own requirement (its assigned, unpaid tickets at their agreed prices), never a figure the buyer
 * types: funding commits exactly what the work was priced at.
 */
export const FundableStageSchema = z.object({
	/** The project's `prj-…` slug (the canonical `/projects/{slug}` address). */
	projectId: z.string().max(64),
	projectTitle: z.string().max(160),
	/** The stage's row id — what the funding call names. */
	stageId: z.string().max(64),
	stageName: z.string().max(120),
	amount: MoneyViewSchema,
	/** How many assigned, unpaid tickets the funding covers. */
	ticketCount: z.number().int().min(0),
});
export type FundableStage = z.infer<typeof FundableStageSchema>;

/** Overview extras for a business wallet. */
export const BusinessExtrasSchema = z.object({
	burnDown: BudgetBurnSchema,
	caps: z.array(SpendingCapViewSchema),
	invoicesDue: z.number().int().min(0),
	invoicesDueAmount: MoneyViewSchema.nullable(),
	/** Stages the viewer may fund from this wallet right now; empty when none is waiting. */
	fundable: z.array(FundableStageSchema).max(40).default([]),
});
export type BusinessExtras = z.infer<typeof BusinessExtrasSchema>;
// #endregion

// #region Standing (the earned rung + its commission taper)
/**
 * One rung of the earned Standing ladder, as the wallet surfaces it. Mirrors `org.standing_levels`
 * (the non-money columns, `@projective/types/org/standing`) joined to `finance.standing_commission_tiers`
 * (the money perk, {@link StandingCommissionTierSchema}) — the wallet is the one surface that needs
 * BOTH halves at once, because the whole point of showing a rung here is its commission payoff.
 *
 * finance-model.md §16.3: L1 New 8% · L2 Established 8% · L3 Trusted 7.5% · L4 Expert 7% · L5 Elite 6.5%.
 */
export const StandingRungSchema = z.object({
	level: z.number().int().min(1).max(5),
	/** "New" · "Established" · "Trusted" · "Expert" · "Elite". */
	label: z.string().max(40),
	/** The Reliability Index floor for this rung (0 · 55 · 70 · 82 · 92). */
	minScore: z.number().int().min(0).max(100),
	/** The completed-stage volume floor (0 · 5 · 20 · 50 · 120) — the SECOND gate an arc can't express. */
	minStages: z.number().int().min(0),
	/** The marketplace commission at this rung, in basis points (800 · 800 · 750 · 700 · 650). */
	commissionBp: basisPoints,
});
export type StandingRung = z.infer<typeof StandingRungSchema>;

/** Which gate is holding a subject below the next rung (both floors must clear). */
export const StandingGate = z.enum(["score", "stages", "both", "none"]);
export type StandingGate = z.infer<typeof StandingGate>;

/** One weighted input of the Reliability Index, for the "why am I this rung" disclosure. */
export const StandingComponentSchema = z.object({
	key: z.enum(["completion", "on_time", "reviews", "dispute_free", "workload", "tenure"]),
	label: z.string().max(60),
	/** The component's weight in the index (25 · 25 · 20 · 15 · 10 · 5). */
	weight: z.number().int().min(0).max(100),
	/** The subject's score on this component, 0–100. */
	scored: z.number().min(0).max(100),
});
export type StandingComponent = z.infer<typeof StandingComponentSchema>;

/**
 * The wallet's Standing projection — the EARNED rung, its position on the continuous Reliability
 * Index, and the marketplace-commission taper that is its direct financial payoff.
 *
 * Two invariants this shape exists to protect:
 *  1. **Standing is earned, never purchasable** (finance-model.md §16.5). Nothing in a subscription
 *     writes here; the shape carries no plan/upgrade field precisely so a surface cannot imply one.
 *  2. **The flat 5% platform service fee does NOT taper** — {@link platformFeeBp} is carried alongside
 *     {@link commissionBp} so the two can be shown together and never conflated (§16.4).
 *
 * A read projection over `org.entity_standing` + `finance.standing_commission_tiers`; no wallet table.
 */
export const WalletStandingSchema = z.object({
	/** Whose standing this is — a buyer-only subject carries none, so the block is nullable upstream. */
	subject: z.enum(["user", "freelancer", "team"]),
	level: z.number().int().min(1).max(5),
	label: z.string().max(40),
	/** The continuous Reliability Index, 0–100. */
	score: z.number().min(0).max(100),
	stagesCompleted: z.number().int().min(0),
	/** The full five-rung ladder, so the gauge can mark every threshold on its arc. */
	ladder: z.array(StandingRungSchema).max(5),
	/** The rung above; `null` at L5 (already at the top). */
	next: StandingRungSchema.nullable(),
	/** Index points still needed for {@link next}; `0` when the score floor is already cleared. */
	scoreToNext: z.number().min(0),
	/** Completed stages still needed for {@link next}; `0` when the volume floor is already cleared. */
	stagesToNext: z.number().int().min(0),
	blockedBy: StandingGate,
	/** The subject's CURRENT marketplace commission, in basis points. */
	commissionBp: basisPoints,
	/** The commission at the next rung; `null` at L5, or when the next rung does not improve it. */
	nextCommissionBp: basisPoints.nullable(),
	/** The flat platform service fee (500bp = 5%). Never tapers — shown so it can't be confused. */
	platformFeeBp: basisPoints,
	components: z.array(StandingComponentSchema).max(8),
	/**
	 * Commission actually charged over the trailing window, as money — the taper made concrete.
	 * `null` when the subject has no earning history to price it against.
	 */
	commissionPaid: MoneyViewSchema.nullable(),
	/**
	 * What that same trailing volume would have cost at {@link next}'s rate — i.e. the money the next
	 * rung is worth. `null` at L5 or without history. NEVER a projection of future earnings.
	 */
	commissionAtNext: MoneyViewSchema.nullable(),
	/** The earned volume {@link commissionPaid}/{@link commissionAtNext} are priced against. */
	volumeWindow: MoneyViewSchema.nullable(),
	/** The window those figures cover ("Last 12 months"). */
	windowLabel: z.string().max(40),
});
export type WalletStanding = z.infer<typeof WalletStandingSchema>;
// #endregion

// #region Overview (the calm hub)
/** The 30/60/90-day window the overview sparkline reports over. */
export const FlowRange = z.enum(["30d", "60d", "90d"]);
export type FlowRange = z.infer<typeof FlowRange>;

/**
 * The fund states in order of how soon the money can be spent: now, after the 7-day window, once the
 * work is approved, once a case closes — the direction money actually travels, read backwards. The
 * allocation meter and the hero's figures both read in this order.
 */
export const FUND_STATE_ORDER: readonly FundState[] = ["available", "pending", "locked", "on_hold"];

/** Below this true share (basis points) a slice is a sliver: drawn as a pip at {@link SLIVER_WIDTH_BP}. */
export const SLIVER_BP = 150;
/** The width a sliver is drawn at, so a share that is not nothing never renders as nothing. */
export const SLIVER_WIDTH_BP = 150;

/**
 * One fund state's slice of the balance, as the allocation meter draws it. `shareBp` is the TRUE share
 * of the whole; `widthBp` is the geometry the segment is drawn at — the same number, except that a
 * sliver is floored at {@link SLIVER_WIDTH_BP} and the difference is taken from the largest slice, so the
 * drawn widths still sum to exactly 10000. `percent` is the legend's whole percent (largest-remainder,
 * `<1%` for a sliver that is not nothing).
 */
export const AllocationSliceSchema = z.object({
	state: FundState,
	value: MoneyViewSchema,
	shareBp: basisPoints,
	widthBp: basisPoints,
	percent: z.string().max(8),
	sliver: z.boolean(),
});
export type AllocationSlice = z.infer<typeof AllocationSliceSchema>;

/**
 * Whole percents that always add up to 100: each share is floored, then the points left over go to the
 * largest remainders. Rounding each share on its own lets three thirds print as 33% + 33% + 33%.
 */
function wholePercents(ratios: readonly number[]): number[] {
	const raw = ratios.map((r) => r * 100);
	const floors = raw.map(Math.floor);
	let left = 100 - floors.reduce((a, b) => a + b, 0);
	const order = raw.map((v, i) => ({ i, rem: v - floors[i] })).sort((a, b) => b.rem - a.rem);
	for (const { i } of order) {
		if (left <= 0) break;
		if (ratios[i] <= 0) continue;
		floors[i] += 1;
		left -= 1;
	}
	return floors;
}

/**
 * Basis points that sum to exactly 10000 across the non-zero slices (largest remainder), so the drawn
 * segments fill the track with no hairline gap and no overflow.
 */
function wholeBasisPoints(minor: readonly number[], total: number): number[] {
	const raw = minor.map((m) => (m / total) * 10000);
	const floors = raw.map(Math.floor);
	let left = 10000 - floors.reduce((a, b) => a + b, 0);
	const order = raw.map((v, i) => ({ i, rem: v - floors[i] })).sort((a, b) => b.rem - a.rem);
	for (const { i } of order) {
		if (left <= 0) break;
		if (minor[i] <= 0) continue;
		floors[i] += 1;
		left -= 1;
	}
	return floors;
}

/**
 * How a balance divides across the fund states — only the states that hold something, in
 * {@link FUND_STATE_ORDER}. Pure: the fat service calls it with the SAME four figures it summed into the
 * total, so the meter's segments add up to the figure above them; the client never recomputes it.
 */
export function allocationSlices(
	values: Readonly<Record<FundState, MoneyView>>,
): AllocationSlice[] {
	const minor = FUND_STATE_ORDER.map((state) => Math.max(0, values[state].minor));
	const total = minor.reduce((a, b) => a + b, 0);
	if (total <= 0) return [];
	const share = wholeBasisPoints(minor, total);
	const percents = wholePercents(minor.map((m) => m / total));
	const width = [...share];
	const live = minor.map((m) => m > 0);
	let debt = 0;
	share.forEach((bp, i) => {
		if (live[i] && bp < SLIVER_BP) {
			debt += SLIVER_WIDTH_BP - bp;
			width[i] = SLIVER_WIDTH_BP;
		}
	});
	if (debt > 0) {
		const largest = width.reduce((best, bp, i) => (bp > width[best] ? i : best), 0);
		width[largest] = Math.max(SLIVER_WIDTH_BP, width[largest] - debt);
	}
	const slices: AllocationSlice[] = [];
	FUND_STATE_ORDER.forEach((state, i) => {
		if (!live[i]) return;
		slices.push({
			state,
			value: values[state],
			shareBp: share[i],
			widthBp: width[i],
			percent: percents[i] === 0 ? "<1%" : `${percents[i]}%`,
			sliver: share[i] < SLIVER_BP,
		});
	});
	return slices;
}

/**
 * The Overview hub projection — the calm landing. The shared spine (three-state balances + money on the
 * way + the in/out sparkline + 5 recent lines + the capability-gated quick actions + the verification
 * gate) plus exactly one populated variant-extras block.
 */
export const WalletOverviewSchema = z.object({
	ref: WalletRefSchema,
	variant: WalletVariant,
	balances: WalletBalancesSchema,
	available: MoneyViewSchema,
	locked: MoneyViewSchema,
	pending: MoneyViewSchema,
	onHold: MoneyViewSchema,
	lifetime: MoneyViewSchema,
	/**
	 * `available + locked + pending + onHold` — the whole the four-state meter divides. Summed and
	 * formatted SERVER-side: the client may compute a display *ratio* (`minor / Σminor`) to size a
	 * segment, but never a total, and never a currency string (finance-model.md §7).
	 */
	capital: MoneyViewSchema,
	/**
	 * The four-state meter's slices, computed server-side from the same four figures ({@link
	 * allocationSlices}); empty when the wallet holds nothing, and empty for the read-only rollup, which
	 * carries available cash only.
	 */
	allocation: z.array(AllocationSliceSchema).max(4),
	/** Active stages the Locked balance is working on — the legend's "Working on 3 stages" note. */
	lockedStageCount: z.number().int().min(0),
	/** Open dispute cases the On-hold balance is frozen against — the legend's "1 case in review". */
	heldCaseCount: z.number().int().min(0),
	incoming: z.array(IncomingItemSchema).max(12),
	flow: z.array(FlowPointSchema).max(24),
	flowRange: FlowRange,
	recent: z.array(LedgerLineSchema).max(8),
	quickActions: z.array(WalletAction).max(10),
	/**
	 * Offered actions that cannot run in this environment, each with the reason — shown locked with the
	 * sentence rather than removed (the viewer holds the capability; what is missing is not theirs to
	 * fix) and refused server-side regardless. A payment processor, for example, is what a top-up or a
	 * withdrawal needs and what this deployment may not have.
	 */
	unavailable: z.array(z.object({ action: WalletAction, reason: z.string().max(200) })).max(10)
		.default([]),
	capabilities: z.array(VaultCapability),
	verification: WalletVerificationSchema,
	/**
	 * The earned Standing rung + its commission taper. `null` for a buyer-only subject (a client
	 * wallet, a business/organisation vault) and for the read-only aggregate — those carry no
	 * Standing, so the surface omits the gauge rather than drawing an empty one.
	 */
	standing: WalletStandingSchema.nullable(),
	personal: PersonalExtrasSchema.nullable(),
	team: TeamExtrasSchema.nullable(),
	business: BusinessExtrasSchema.nullable(),
});
export type WalletOverview = z.infer<typeof WalletOverviewSchema>;
// #endregion

// #region Transactions page
/** The ledger table sort key. */
export const TxnSort = z.enum(["date", "amount", "counterparty", "category", "status"]);
export type TxnSort = z.infer<typeof TxnSort>;

/**
 * The ledger filters (search · direction · fund state · category · line family · project · date range).
 *
 * Paging is KEYSET, not offset: `cursor` is `k:<base64url("<created_at ISO>|<id>")>` — the last line of
 * the previous page — and the next page is every matching line strictly older than it in
 * `(created_at DESC, id DESC)` order (`finance.list_ledger`). A line written while the reader scrolls
 * can therefore never shift a page boundary and repeat or skip a row, which an offset would. Keyset
 * paging is defined for the date order only; `sort`/`dir` re-order the lines already loaded.
 */
export const TransactionListParamsSchema = z.object({
	scope: WalletScope.optional(),
	contextId: z.string().max(64).optional(),
	display: currency.optional(),
	search: z.string().max(160).optional(),
	direction: TransactionDirection.optional(),
	fundState: FundState.optional(),
	category: TxnCategory.optional(),
	/** Line families to include (any of); absent or empty means every family. */
	kinds: z.array(LedgerKind).max(12).optional(),
	/**
	 * The ruler's window, resolved server-side on the viewer's calendar ("the last 7 days" is today and
	 * the six days before it); an explicit `from` wins.
	 */
	range: z.lazy(() => ActivityRange).optional(),
	project: z.string().max(64).optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	sort: TxnSort.optional(),
	dir: z.enum(["asc", "desc"]).optional(),
	cursor: z.string().max(200).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type TransactionListParams = z.infer<typeof TransactionListParamsSchema>;

/** A keyset position in the ledger: the `(created_at, id)` of the last line already read. */
export interface LedgerKeyset {
	at: string;
	id: string;
}

const KEYSET_RE = /^k:([A-Za-z0-9_-]+)$/;
const KEYSET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encodes a keyset position as an opaque `k:` cursor (base64url, no padding). */
export function encodeLedgerCursor(key: LedgerKeyset): string {
	const bytes = new TextEncoder().encode(`${key.at}|${key.id}`);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return `k:${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** Decodes a `k:` cursor; anything malformed (or an old `o:` offset cursor) is `null` — the first page. */
export function decodeLedgerCursor(cursor: string | null | undefined): LedgerKeyset | null {
	const match = cursor ? KEYSET_RE.exec(cursor) : null;
	if (!match) return null;
	try {
		const b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
		const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
		const text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
		const bar = text.lastIndexOf("|");
		const at = text.slice(0, bar);
		const id = text.slice(bar + 1);
		if (bar <= 0 || !Number.isFinite(Date.parse(at)) || !KEYSET_UUID_RE.test(id)) return null;
		return { at: new Date(at).toISOString(), id };
	} catch {
		return null;
	}
}

/** A page of ledger lines plus the projects present in the corpus (drives the project filter chips). */
export const TransactionPageSchema = z.object({
	items: z.array(LedgerLineSchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(200).nullable(),
	/** How many lines match, where it is known; keyset paging never counts, so this is `null` there. */
	total: z.number().int().min(0).nullable(),
	/** Distinct projects seen (for the filter dropdown) — `{ id, name }`. */
	projects: z.array(z.object({ id: z.string().max(64), name: z.string().max(120) })).max(60),
});
export type TransactionPage = z.infer<typeof TransactionPageSchema>;
// #endregion

// #region Activity (cash flow)
/**
 * The cash-flow window, each summed server-side: a week, a month, a quarter, half a year, a year, five
 * years, or everything the wallet has recorded (`all`, which starts at the wallet's oldest movement).
 */
export const ActivityRange = z.enum(["7d", "30d", "90d", "180d", "12m", "5y", "all"]);
export type ActivityRange = z.infer<typeof ActivityRange>;

/** One category slice of the by-category breakdown. */
export const CategorySliceSchema = z.object({
	category: TxnCategory,
	amount: MoneyViewSchema,
	shareBp: basisPoints,
});
export type CategorySlice = z.infer<typeof CategorySliceSchema>;

/** One project's cashflow contribution. */
export const ProjectFlowSchema = z.object({
	id: z.string().max(64),
	name: z.string().max(120),
	amount: MoneyViewSchema,
});
export type ProjectFlow = z.infer<typeof ProjectFlowSchema>;

/**
 * The calendar unit a cash-flow bucket spans, truncated in the viewer's time zone
 * (`date_trunc(grain, created_at AT TIME ZONE tz)` — `finance.ledger_flow`). A week starts on Monday.
 */
export const FlowGrain = z.enum(["day", "week", "month"]);
export type FlowGrain = z.infer<typeof FlowGrain>;

/** One line family's volume over the window: what came in, what went out, and its share of both. */
export const KindSliceSchema = z.object({
	kind: LedgerKind,
	amountIn: MoneyViewSchema,
	amountOut: MoneyViewSchema,
	/** `in + out` — what the family moved, the figure the breakdown ranks by. */
	volume: MoneyViewSchema,
	/** The family's share of the window's whole volume. */
	shareBp: basisPoints,
	lines: z.number().int().min(0),
});
export type KindSlice = z.infer<typeof KindSliceSchema>;

/**
 * One projected clearance on the release schedule: money clearing its 7-day window on a known date,
 * escrow on a stage with a due date (projected to clear a safety window after it), or escrow awaiting
 * approval with no date at all — never a date the platform does not have.
 */
export const ReleaseItemSchema = z.object({
	id: z.string().max(64),
	label: z.string().max(160),
	href: z.string().max(200).nullable(),
	amount: MoneyViewSchema,
	/** `pending` — clearing; `locked` — still in escrow on the stage. */
	state: FundState,
	/** When the money is projected to become spendable; `null` when nothing dates it. */
	at: timestamp.nullable(),
	basis: z.enum(["clearing", "stage_due", "awaiting_approval"]),
});
export type ReleaseItem = z.infer<typeof ReleaseItemSchema>;

/**
 * A project ranked by the capital allocated to it from this wallet: escrow held on its stages plus
 * releases still clearing, with what it moved in the window beside it.
 */
export const ProjectAllocationSchema = z.object({
	id: z.string().max(64),
	name: z.string().max(120),
	href: z.string().max(200).nullable(),
	held: MoneyViewSchema,
	clearing: MoneyViewSchema,
	/** `held + clearing`. */
	allocated: MoneyViewSchema,
	/** What moved on the project's lines within the window. */
	moved: MoneyViewSchema,
	/** The project's share of everything allocated across the listed projects. */
	shareBp: basisPoints,
});
export type ProjectAllocation = z.infer<typeof ProjectAllocationSchema>;

/**
 * The Activity projection — where the charts live (kept off the calm overview). In-vs-out, by-category,
 * by-project, plus role-specific series: a freelancer's locked capital + projected income, a
 * business's budget burn-down.
 *
 * The flow series and every total are summed IN THE DATABASE over the whole window
 * (`finance.ledger_flow`), bucketed on the viewer's calendar (`timezone`), so a long window is no longer
 * read through the most recent thousand lines.
 */
export const ActivityViewSchema = z.object({
	range: ActivityRange,
	grain: FlowGrain,
	/** The IANA zone the buckets were truncated in. */
	timezone: z.string().max(64),
	flow: z.array(FlowPointSchema).max(64),
	byCategory: z.array(CategorySliceSchema).max(12),
	byKind: z.array(KindSliceSchema).max(12),
	byProject: z.array(ProjectFlowSchema).max(24),
	topProjects: z.array(ProjectAllocationSchema).max(12),
	releases: z.array(ReleaseItemSchema).max(24),
	totalIn: MoneyViewSchema,
	totalOut: MoneyViewSchema,
	net: MoneyViewSchema,
	lockedCapital: MoneyViewSchema.nullable(),
	projectedIncome: MoneyViewSchema.nullable(),
	burnDown: BudgetBurnSchema.nullable(),
});
export type ActivityView = z.infer<typeof ActivityViewSchema>;
// #endregion

// #region Payouts page
/** The payout schedule projection. */
export const PayoutScheduleViewSchema = z.object({
	mode: PayoutMode,
	destinationLabel: z.string().max(120).nullable(),
	threshold: MoneyViewSchema.nullable(),
	instant: z.boolean(),
	nextRunLabel: z.string().max(60).nullable(),
});
export type PayoutScheduleView = z.infer<typeof PayoutScheduleViewSchema>;

/** A payout destination (a payout-tagged method). */
export const PayoutDestinationSchema = z.object({
	id: z.string().max(64),
	label: z.string().max(120),
	brand: z.string().max(40).nullable(),
	last4: z.string().max(4).nullable(),
	isDefault: z.boolean(),
});
export type PayoutDestination = z.infer<typeof PayoutDestinationSchema>;

/** A past withdrawal. */
export const PayoutHistoryRowSchema = z.object({
	id: z.string().max(64),
	amount: MoneyViewSchema,
	/** Member for member with `finance.payout_status` (#125(e): the projection once said `in_transit`, which the table cannot hold, and had no `cancelled`). */
	status: z.enum(["pending", "paid", "failed", "cancelled"]),
	destinationLabel: z.string().max(120),
	at: timestamp,
	dateLabel: z.string().max(40),
});
export type PayoutHistoryRow = z.infer<typeof PayoutHistoryRowSchema>;

/**
 * The Payouts projection — the schedule editor, destinations, the Income Smoother, the Instant Payout
 * offer (fee is TBD platform-wide — presented as configurable, never a fabricated %), and history.
 */
export const PayoutsViewSchema = z.object({
	schedule: PayoutScheduleViewSchema,
	destinations: z.array(PayoutDestinationSchema),
	incomeSmoother: IncomeSmootherStateSchema.nullable(),
	instantAvailable: MoneyViewSchema,
	/** The Instant Payout fee disclosure ("Fee set at payout" — magnitude is TBD, finance-model §1.4). */
	instantFeeLabel: z.string().max(80),
	history: z.array(PayoutHistoryRowSchema),
	verification: WalletVerificationSchema,
});
export type PayoutsView = z.infer<typeof PayoutsViewSchema>;
// #endregion

// #region Funding page
/** A funding source (a funding-tagged method). */
export const FundingSourceSchema = z.object({
	id: z.string().max(64),
	label: z.string().max(120),
	brand: z.string().max(40).nullable(),
	last4: z.string().max(4).nullable(),
	role: MethodRole,
	isDefault: z.boolean(),
});
export type FundingSource = z.infer<typeof FundingSourceSchema>;

/** A recurring auto-deposit rule projection. */
export const DepositRuleViewSchema = z.object({
	id: z.string().max(64),
	amount: MoneyViewSchema,
	interval: DepositInterval,
	sourceLabel: z.string().max(120).nullable(),
	nextRunLabel: z.string().max(60),
	active: z.boolean(),
	/** The failure-path note ("Last run failed — card declined") when a rule is failing; else `null`. */
	failureNote: z.string().max(200).nullable(),
});
export type DepositRuleView = z.infer<typeof DepositRuleViewSchema>;

/** The Funding projection — sources + recurring auto-deposit rules + the top-up entry. */
export const FundingViewSchema = z.object({
	sources: z.array(FundingSourceSchema),
	rules: z.array(DepositRuleViewSchema),
	balance: MoneyViewSchema,
});
export type FundingView = z.infer<typeof FundingViewSchema>;
// #endregion

// #region Methods page
/** A payment method projection (tagged spend / earn / both). Card data is Stripe-owned — never stored. */
export const PaymentMethodViewSchema = z.object({
	id: z.string().max(64),
	provider: z.string().max(40),
	brand: z.string().max(40).nullable(),
	last4: z.string().max(4).nullable(),
	label: z.string().max(120).nullable(),
	methodRole: MethodRole,
	isDefaultFunding: z.boolean(),
	isDefaultPayout: z.boolean(),
	status: z.enum(["active", "inactive", "expired"]),
});
export type PaymentMethodView = z.infer<typeof PaymentMethodViewSchema>;

/** The Methods projection. */
export const MethodsViewSchema = z.object({
	methods: z.array(PaymentMethodViewSchema),
});
export type MethodsView = z.infer<typeof MethodsViewSchema>;
// #endregion

// #region Invoices page (business)
/** A monthly statement row. */
export const StatementRowSchema = z.object({
	id: z.string().max(64),
	periodLabel: z.string().max(60),
	totalIn: MoneyViewSchema,
	totalOut: MoneyViewSchema,
	totalFees: MoneyViewSchema,
	status: StatementStatus,
	hasPdf: z.boolean(),
});
export type StatementRow = z.infer<typeof StatementRowSchema>;

/** A bill / invoice due. */
export const BillRowSchema = z.object({
	id: z.string().max(64),
	label: z.string().max(160),
	amount: MoneyViewSchema,
	dueLabel: z.string().max(40),
	status: InvoiceStatus,
	overdue: z.boolean(),
});
export type BillRow = z.infer<typeof BillRowSchema>;

/**
 * The Invoices projection (business) — the accruing current-cycle statement, past statements, bills due,
 * and the per-member caps (with over-budget top-up prompts derived from utilization).
 */
export const InvoicesViewSchema = z.object({
	current: StatementRowSchema.nullable(),
	statements: z.array(StatementRowSchema),
	bills: z.array(BillRowSchema),
	caps: z.array(SpendingCapViewSchema),
});
export type InvoicesView = z.infer<typeof InvoicesViewSchema>;
// #endregion

// #region Access page (team/business)
/** A vault member + their capability grants (the capability matrix rows). */
export const VaultMemberSchema = z.object({
	userId: z.string().max(64),
	handle: z.string().max(40).nullable(),
	name: z.string().max(120),
	avatar: z.string().max(600).nullable(),
	role: VaultRole,
	capabilities: z.array(VaultCapability),
});
export type VaultMember = z.infer<typeof VaultMemberSchema>;

/** A queued over-cap spend awaiting a second approver. */
export const SpendApprovalViewSchema = z.object({
	id: z.string().max(64),
	requesterName: z.string().max(120),
	requesterHandle: z.string().max(40).nullable(),
	amount: MoneyViewSchema,
	reason: z.string().max(400),
	status: ApprovalStatus,
	at: timestamp,
	dateLabel: z.string().max(40),
});
export type SpendApprovalView = z.infer<typeof SpendApprovalViewSchema>;

/** An audit-log row (who/when/amount of a vault money move). */
export const AuditRowSchema = z.object({
	id: z.string().max(64),
	actorName: z.string().max(120),
	actorHandle: z.string().max(40).nullable(),
	action: VaultAction,
	amount: MoneyViewSchema,
	label: z.string().max(200),
	at: timestamp,
	dateLabel: z.string().max(40),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;

/**
 * The Access projection (team/business) — the capability matrix, spending caps, the pending-approvals
 * queue, and the money audit log. `viewerCapabilities` gates which controls the viewer may operate.
 */
export const AccessViewSchema = z.object({
	members: z.array(VaultMemberSchema),
	caps: z.array(SpendingCapViewSchema),
	approvals: z.array(SpendApprovalViewSchema),
	audit: z.array(AuditRowSchema),
	viewerCapabilities: z.array(VaultCapability),
});
export type AccessView = z.infer<typeof AccessViewSchema>;
// #endregion

// #region Mutation payloads (the action modals)
/** The wallet a mutation targets. */
const targetShape = {
	scope: WalletScope,
	contextId: z.string().max(64),
	/** The display currency the response should be projected back in. */
	display: currency.optional(),
};

/**
 * Top up the wallet's Available balance by card. The action answers with a PaymentIntent handoff for
 * the Payment Element (`WalletCardHandoff.payment`); the wallet is credited only when the signed
 * `payment_intent.succeeded` webhook settles it (Decision #125/#126).
 */
export const TopUpInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	methodId: z.string().max(64).nullable(),
	idempotencyKey: z.string().min(8).max(120),
});
export type TopUpInput = z.infer<typeof TopUpInputSchema>;

/**
 * Withdraw Available balance to the owner's verified Stripe Connect payout account (optionally
 * Instant — recorded, but no Instant fee is charged while its magnitude is undecided, #55(c)). The
 * wallet is debited at once and the money leaves as a Stripe Transfer (`finance.begin_payout`).
 */
export const WithdrawInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	destinationId: z.string().max(64).nullable(),
	instant: z.boolean(),
	idempotencyKey: z.string().min(8).max(120),
});
export type WithdrawInput = z.infer<typeof WithdrawInputSchema>;

/**
 * A client-minted key held for the life of ONE attempt at a money movement, so a retried request
 * answers with what the first one did instead of moving the money twice.
 */
const attemptKey = z.string().min(8).max(120);

/**
 * Move funds between two of the viewer's wallets. The amount is in the SOURCE wallet's own currency —
 * a transfer is never a conversion, and both wallets must hold the same currency.
 */
export const TransferInputSchema = z.object({
	fromScope: WalletScope,
	fromId: z.string().max(64),
	toScope: WalletScope,
	toId: z.string().max(64),
	amountMinor: minorUnitsPositive,
	currency,
	note: z.string().max(200).nullable(),
	display: currency.optional(),
	idempotencyKey: attemptKey,
});
export type TransferInput = z.infer<typeof TransferInputSchema>;

/**
 * Distribute part of a team vault to its members by their agreed stakes. The amount is in the vault's
 * own currency.
 */
export const DistributeInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	idempotencyKey: attemptKey,
});
export type DistributeInput = z.infer<typeof DistributeInputSchema>;

/**
 * Fund an assigned stage's escrow from the wallet. `amountMinor` + `currency` are the stage's
 * requirement as the buyer was SHOWN it (a {@link FundableStage}); the server refuses when the stage
 * would now commit a different figure, rather than committing one nobody confirmed.
 */
export const FundEscrowInputSchema = z.object({
	...targetShape,
	stageId: z.string().max(64),
	amountMinor: minorUnitsPositive,
	currency,
});
export type FundEscrowInput = z.infer<typeof FundEscrowInputSchema>;

/** Create a recurring auto-deposit rule. */
export const DepositRuleInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	interval: DepositInterval,
	sourceMethodId: z.string().max(64).nullable(),
});
export type DepositRuleInput = z.infer<typeof DepositRuleInputSchema>;

/**
 * Save a card. The action answers with a SetupIntent handoff (`WalletCardHandoff.setup`); the card is
 * entered in Stripe's Payment Element and recorded only when the SetupIntent is confirmed — this
 * payload never carries a card number, a token, or any display fragment (finance-model §Payment
 * Methods). What is kept is the brand, the last four digits and Stripe's `pm_…` reference, read from
 * the confirmed SetupIntent — never a name typed here. Funding cards only: a payout destination is the
 * owner's Connect account.
 */
export const AddMethodInputSchema = z.object({
	...targetShape,
	methodRole: MethodRole.default("funding"),
});
export type AddMethodInput = z.infer<typeof AddMethodInputSchema>;

/** Set the payout schedule. */
export const PayoutScheduleInputSchema = z.object({
	...targetShape,
	mode: PayoutMode,
	thresholdMinor: minorUnitsPositive.nullable(),
	destinationId: z.string().max(64).nullable(),
	instant: z.boolean(),
});
export type PayoutScheduleInput = z.infer<typeof PayoutScheduleInputSchema>;

/** Request an over-cap spend (queues a second-approver approval). */
export const SpendRequestInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	reason: z.string().min(1).max(400),
});
export type SpendRequestInput = z.infer<typeof SpendRequestInputSchema>;

/** Approve or reject a queued spend. */
export const SpendDecisionInputSchema = z.object({
	scope: WalletScope,
	contextId: z.string().max(64),
	approvalId: z.string().max(64),
	decision: z.enum(["approve", "reject"]),
	display: currency.optional(),
});
export type SpendDecisionInput = z.infer<typeof SpendDecisionInputSchema>;

/**
 * Enrol in (or, with `enrol: false`, leave) the Income Smoother at a target monthly figure. Eligibility
 * and the fee are decided by `finance.set_income_smoother`, never by the client.
 */
export const IncomeSmootherEnrolInputSchema = z.object({
	targetMonthlyMinor: minorUnitsPositive,
	currency,
	display: currency.optional(),
	enrol: z.boolean().optional(),
});
export type IncomeSmootherEnrolInput = z.infer<typeof IncomeSmootherEnrolInputSchema>;

/** The uniform outcome of a wallet action — the refreshed overview + a human note. */
export const WalletActionResultSchema = z.object({
	overview: WalletOverviewSchema,
	message: z.string().max(200),
});
export type WalletActionResult = z.infer<typeof WalletActionResultSchema>;
// #endregion

// #region Pure helpers (shared client + server — presentation only, no money math)
/** Minor-unit exponent per currency (the fixture set is 2dp; default 2). */
const CURRENCY_EXPONENT: Record<string, number> = {
	JPY: 0,
	KWD: 3,
	BHD: 3,
	USD: 2,
	GBP: 2,
	EUR: 2,
};

/** The minor-unit exponent for a currency (default 2). */
export function currencyExponent(code: string): number {
	return CURRENCY_EXPONENT[code.toUpperCase()] ?? 2;
}

/**
 * Convert a MAJOR-unit figure a person typed into the MINOR units every schema and column stores.
 *
 * Exponent-aware on purpose: a hardcoded `x 100` turns a JP¥5,000 figure into 500,000 minor units, a
 * hundredfold error no type-checker can see because both sides are `number` and both are plausible.
 *
 * Clamped at zero and null-preserving, because both are facts the callers depend on: a negative price
 * is not a price, and `null` means UNPRICED where `0` means free — a distinction the setup ladder
 * counts and a `??` would quietly collapse.
 *
 * Lives here beside {@link currencyExponent} rather than in a feature, because two surfaces of the
 * project-creation flow had already grown their own copies and they had already diverged on the
 * clamp. Presentation-boundary conversion ONLY — this is not money math and computes no balance,
 * fee or split.
 */
export function toMinorUnits(major: number | null, code: string): number | null {
	if (major === null || !Number.isFinite(major)) return null;
	return Math.max(0, Math.round(major * 10 ** currencyExponent(code)));
}

/** The inverse of {@link toMinorUnits}, for seeding an input from a stored amount. */
export function toMajorUnits(minor: number | null, code: string): number | null {
	if (minor === null || !Number.isFinite(minor)) return null;
	return minor / 10 ** currencyExponent(code);
}

/**
 * Format a minor-unit amount in a currency for the viewer's locale via `Intl.NumberFormat`. Deterministic
 * given `(minor, currency, locale)`, so SSR and the client render identically (mirrors the catalogue
 * `money()` determinism guarantee). Presentation ONLY — never used to compute a balance/split/fee.
 */
export function formatMoney(minor: number, code: string, locale = "en-GB"): string {
	const exp = currencyExponent(code);
	const major = minor / 10 ** exp;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: code.toUpperCase(),
			minimumFractionDigits: exp,
			maximumFractionDigits: exp,
		}).format(major);
	} catch {
		// Unknown currency code — fall back to a plain grouped number with the code suffix.
		return `${major.toFixed(exp)} ${code.toUpperCase()}`;
	}
}

/**
 * Build the canonical {@link MoneyView} for a {@link ConvertedAmount}.
 *
 * This is the ONE bridge between the FX engine and the money shape every surface renders, so a
 * converted figure is assembled identically wherever it is produced. Both `display` strings are
 * formatted here, server-side, in the viewer's locale — the client renders them verbatim so SSR and
 * a hydrated island are byte-identical.
 *
 * `origin` is populated only when a conversion actually happened. A same-currency figure carries
 * `origin: null` and therefore renders with no FX disclosure at all, which is correct: there is
 * nothing approximate about it, and a "(~£12.00 GBP)" tail beside £12.00 would manufacture doubt
 * about an exact number.
 */
export function toMoneyView(amount: ConvertedAmount, locale = DEFAULT_LOCALE): MoneyView {
	return {
		minor: amount.minor,
		currency: amount.currency,
		display: formatMoney(amount.minor, amount.currency, locale),
		origin: amount.converted
			? {
				minor: amount.origin.minor,
				currency: amount.origin.currency,
				display: formatMoney(amount.origin.minor, amount.origin.currency, locale),
				fxRate: amount.rate,
			}
			: null,
	};
}

/** The capability preset a coarse {@link VaultRole} grants. Owner ⊇ Admin ⊇ PM ⊇ Member. */
export function capabilitiesForRole(role: VaultRole): VaultCapability[] {
	switch (role) {
		case "owner":
			return [
				"view",
				"add_funds",
				"spend",
				"distribute",
				"withdraw",
				"manage_members",
				"manage_billing",
				"approve_spend",
			];
		// `manage_members` implies every capability in finance.fn_has_vault_capability, approving spends
		// included — a preset that omitted `approve_spend` could never surface it (#125(e)).
		case "admin":
			return ["view", "add_funds", "spend", "distribute", "withdraw", "manage_members", "approve_spend"];
		case "pm":
			return ["view", "add_funds", "spend"];
		case "member":
			return ["view"];
	}
}

/** Whether a capability set includes a capability. */
export function hasCapability(caps: readonly VaultCapability[], cap: VaultCapability): boolean {
	return caps.includes(cap);
}

/** Map a wallet scope to its overview face (organisation folds into the business face). */
export function walletVariant(scope: WalletScope): WalletVariant {
	if (scope === "team") return "team";
	if (scope === "business" || scope === "organisation") return "business";
	return "personal";
}
// #endregion

// #region Read query (shared server read shape)
/**
 * A resolved wallet read query: which wallet, and in which display currency. Who is asking is the
 * signed-in caller — the service reads everything as them, so nothing about the viewer travels here.
 */
export interface WalletQuery {
	/** `personal` · `team:{id}` · `business:{id}` · `organisation:{id}` · `aggregate`; null → active. */
	wallet?: string | null;
	/** An explicit display currency (the page's `?display=`); wins over the viewer's preference. */
	display?: string | null;
	/** The viewer's preferred display currency (their account setting); used when none is explicit. */
	viewerCurrency?: string | null;
	/**
	 * The IANA zone the request's calendar runs in (the browser's `?tz=`); the viewer's profile zone, then
	 * UTC, when absent or not a zone.
	 */
	timezone?: string | null;
}
// #endregion
