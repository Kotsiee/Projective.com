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
	href: z.string().max(200).nullable(),
});
export type IncomingItem = z.infer<typeof IncomingItemSchema>;

/** One bucket of the in-vs-out cashflow series (a day/week/month, per range). */
export const FlowPointSchema = z.object({
	label: z.string().max(20),
	inMinor: minorUnitsNonNeg,
	outMinor: minorUnitsNonNeg,
});
export type FlowPoint = z.infer<typeof FlowPointSchema>;

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
	amount: MoneyViewSchema,
	fundState: FundState,
	category: TxnCategory,
	refKind: z.enum(["stage", "session", "invoice", "payout", "deposit", "transfer", "fee"])
		.nullable(),
	refId: z.string().max(64).nullable(),
	href: z.string().max(200).nullable(),
	at: timestamp,
	dateLabel: z.string().max(40),
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
	cap: MoneyViewSchema,
	spent: MoneyViewSchema,
	interval: SpendingLimitInterval,
	utilizationBp: basisPoints,
	resetsLabel: z.string().max(40).nullable(),
});
export type SpendingCapView = z.infer<typeof SpendingCapViewSchema>;

/** Overview extras for a business wallet. */
export const BusinessExtrasSchema = z.object({
	burnDown: BudgetBurnSchema,
	caps: z.array(SpendingCapViewSchema),
	invoicesDue: z.number().int().min(0),
	invoicesDueAmount: MoneyViewSchema.nullable(),
});
export type BusinessExtras = z.infer<typeof BusinessExtrasSchema>;
// #endregion

// #region Overview (the calm hub)
/** The 30/60/90-day window the overview sparkline reports over. */
export const FlowRange = z.enum(["30d", "60d", "90d"]);
export type FlowRange = z.infer<typeof FlowRange>;

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
	incoming: z.array(IncomingItemSchema).max(12),
	flow: z.array(FlowPointSchema).max(24),
	flowRange: FlowRange,
	recent: z.array(LedgerLineSchema).max(8),
	quickActions: z.array(WalletAction).max(10),
	capabilities: z.array(VaultCapability),
	verification: WalletVerificationSchema,
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

/** The ledger filters (search · direction · fund state · category · project · date range). */
export const TransactionListParamsSchema = z.object({
	scope: WalletScope.optional(),
	contextId: z.string().max(64).optional(),
	display: currency.optional(),
	search: z.string().max(160).optional(),
	direction: TransactionDirection.optional(),
	fundState: FundState.optional(),
	category: TxnCategory.optional(),
	project: z.string().max(64).optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	sort: TxnSort.optional(),
	dir: z.enum(["asc", "desc"]).optional(),
	cursor: z.string().max(120).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type TransactionListParams = z.infer<typeof TransactionListParamsSchema>;

/** A page of ledger lines plus the projects present in the corpus (drives the project filter chips). */
export const TransactionPageSchema = z.object({
	items: z.array(LedgerLineSchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(120).nullable(),
	total: z.number().int().min(0),
	/** Distinct projects seen (for the filter dropdown) — `{ id, name }`. */
	projects: z.array(z.object({ id: z.string().max(64), name: z.string().max(120) })).max(60),
});
export type TransactionPage = z.infer<typeof TransactionPageSchema>;
// #endregion

// #region Activity page (charts)
/** The Activity analytics window. */
export const ActivityRange = z.enum(["30d", "90d", "12m"]);
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
 * The Activity projection — where the charts live (kept off the calm overview). In-vs-out, by-category,
 * by-project, plus role-specific series: a freelancer's locked capital + projected income, a
 * business's budget burn-down.
 */
export const ActivityViewSchema = z.object({
	range: ActivityRange,
	flow: z.array(FlowPointSchema).max(64),
	byCategory: z.array(CategorySliceSchema).max(12),
	byProject: z.array(ProjectFlowSchema).max(24),
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
	status: z.enum(["paid", "in_transit", "failed", "pending"]),
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

/** Top up the wallet's Available balance from a funding method. */
export const TopUpInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	methodId: z.string().max(64).nullable(),
});
export type TopUpInput = z.infer<typeof TopUpInputSchema>;

/** Withdraw Available balance to a payout destination (optionally Instant). */
export const WithdrawInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
	destinationId: z.string().max(64).nullable(),
	instant: z.boolean(),
});
export type WithdrawInput = z.infer<typeof WithdrawInputSchema>;

/** Move funds between two of the viewer's wallets. */
export const TransferInputSchema = z.object({
	fromScope: WalletScope,
	fromId: z.string().max(64),
	toScope: WalletScope,
	toId: z.string().max(64),
	amountMinor: minorUnitsPositive,
	currency,
	note: z.string().max(200).nullable(),
	display: currency.optional(),
});
export type TransferInput = z.infer<typeof TransferInputSchema>;

/** Distribute a team vault's Available balance per the active split ruleset. */
export const DistributeInputSchema = z.object({
	...targetShape,
	amountMinor: minorUnitsPositive,
	currency,
});
export type DistributeInput = z.infer<typeof DistributeInputSchema>;

/** Fund an escrow on a stage from the wallet. */
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
 * Register a payment method. Card entry is Stripe-hosted (Elements) — this payload carries only the
 * opaque provider token + safe display fragments, NEVER a card number (finance-model §Payment Methods).
 */
export const AddMethodInputSchema = z.object({
	...targetShape,
	methodRole: MethodRole,
	provider: z.string().max(40),
	/** Opaque Stripe token (a real integration hands this from Elements). */
	token: z.string().max(200),
	label: z.string().max(120).nullable(),
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

/** Enrol in the Income Smoother at a target monthly figure. */
export const IncomeSmootherEnrolInputSchema = z.object({
	targetMonthlyMinor: minorUnitsPositive,
	currency,
	display: currency.optional(),
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
			];
		case "admin":
			return ["view", "add_funds", "spend", "distribute", "withdraw", "manage_members"];
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

// #region Read query + dev simulation knobs (shared server read shapes)
/** The KYC state the Dev Context Switcher can simulate. `payout_setup` = verified but no payout method. */
export type SimKyc = "verified" | "unverified" | "payout_setup";
/** The Income-Smoother state the switcher can simulate (`auto` follows the store). */
export type SimSmoother = "auto" | "ineligible" | "eligible" | "enrolled";
/** The fund-state mix the switcher can simulate (surface locked / pending / disputed balances). */
export type SimFundMix = "normal" | "locked" | "pending" | "dispute";

/**
 * The fixture-shaping simulation knobs the Dev Context Switcher drives (dev-only; ignored on the live
 * path). Passed as query params the island refetches with — the server never reads the client seam.
 */
export interface WalletSim {
	vaultRole?: VaultRole;
	kyc?: SimKyc;
	smoother?: SimSmoother;
	fundMix?: SimFundMix;
}

/** A resolved wallet read query: which wallet, in which display currency, for whom, under which sim. */
export interface WalletQuery {
	/** `personal` · `team:{id}` · `business:{id}` · `organisation:{id}` · `aggregate`; null → active. */
	wallet?: string | null;
	/** The viewer's display currency (from prefs or the dev axis); defaults to the wallet's own. */
	display?: string | null;
	/** The acting user's `@handle` (the personal wallet owner). */
	viewerHandle?: string | null;
	/** The acting user's id. */
	viewerId?: string | null;
	/** Whether the acting user offers services (freelancer) — decides the personal face's subject. */
	isFreelancer?: boolean;
	sim?: WalletSim;
}
// #endregion
