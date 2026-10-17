import { z } from "zod";
import { SplitRuleType } from "../finance/vault.ts";
import { MoneyViewSchema } from "../finance/wallet.ts";
import { VerificationState } from "./common.ts";

/**
 * workspace/policy — the money-governance layer, and the one place the two entity kinds genuinely
 * diverge rather than merely relabel.
 *
 * A **team's** money moves IN and then splits: a released stage payout divides across the people who
 * did the work. A **business's** money moves IN from its own members and then OUT as purchases: several
 * people fund a pool and several spend from it, bounded by limits and approval thresholds.
 *
 * Both editors render **server-computed {@link MoneyView}s only** — the client never totals, splits,
 * converts or fee-adjusts money (root CLAUDE.md · Decision #55). Shares are carried in **basis points**
 * so the 100% invariant is exact integer arithmetic; a percentage float would drift and the split bar's
 * central promise ("the dividers ARE the total") would quietly stop being true.
 */

// #region Team — money in, then split
/**
 * How the current split reads. It is DERIVED, never stored: `equal` when every unheld active stake is
 * the same within one basis point, `custom` otherwise. (A `by_role` model had no stored definition and
 * was removed.)
 */
export const SplitModel = z.enum(["equal", "custom"]);
export type SplitModel = z.infer<typeof SplitModel>;

/** One member's slice of the split bar. */
export const SplitStakeSchema = z.object({
	memberId: z.string().max(64),
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	/** Share in basis points. The stakes of a valid split sum to exactly 10 000. */
	shareBp: z.number().int().min(0).max(10_000),
	/**
	 * Held back from automatic distribution — the amount stays in the vault for a manual decision
	 * rather than being reassigned, so holding somebody's share never silently pays it to someone else.
	 */
	held: z.boolean().default(false),
	/** What this stake would receive from the projected release (server-computed). */
	projected: MoneyViewSchema,
});
export type SplitStake = z.infer<typeof SplitStakeSchema>;

/**
 * A split the editor can apply in one step. Nothing stores templates; the server offers the team's
 * current split and a computed even split, so the editor's quick-apply is honest about both.
 */
export const SplitTemplateSchema = z.object({
	id: z.string().max(64),
	name: z.string().min(1).max(64),
	model: SplitModel,
	stakes: z.array(SplitStakeSchema),
	/** Whether this is the template applied to new releases. */
	isDefault: z.boolean().default(false),
});
export type SplitTemplate = z.infer<typeof SplitTemplateSchema>;

/** A cut in basis points (10 000 = 100%). */
const splitBp = z.number().int().min(0).max(10_000);

/**
 * The team's ACTIVE split template (`finance.split_rules`, finance-model.md §5) — the rule the release
 * plan applies before the members' stakes: the finder's cut (finders_fee), then the vault's, then the
 * stakes on what is left. A team with no stored rule reads as `co_op` with no vault cut, which is what
 * the plan applies to it. `benevolent_dictator` sends everything to the vault, so its `vaultBp` is
 * 10 000.
 */
export const TeamSplitRuleSchema = z.object({
	ruleType: SplitRuleType,
	vaultBp: splitBp,
	/** The finder's user id — set only under `finders_fee`. */
	finderUserId: z.string().max(64).nullable(),
	/** The finder's cut, taken first — set only under `finders_fee`. */
	finderBp: splitBp.nullable(),
});
export type TeamSplitRule = z.infer<typeof TeamSplitRuleSchema>;

/**
 * A new split template, as the editor writes it (`finance.save_split_rule`). Discriminated on
 * `ruleType` so a template carries exactly the fields it uses: a finder only under `finders_fee`, and
 * no vault cut under `benevolent_dictator` (everything goes to the vault). Ranges are checked here;
 * the combined `finderBp + vaultBp ≤ 10 000` rule, the finder's membership and the plan gate are
 * money policy, enforced once in the RPC.
 */
export const SplitRuleInputSchema = z.discriminatedUnion("ruleType", [
	z.object({
		ruleType: z.literal(SplitRuleType.enum.co_op),
		vaultBp: splitBp,
	}),
	z.object({
		ruleType: z.literal(SplitRuleType.enum.finders_fee),
		vaultBp: splitBp,
		finderUserId: z.string().max(64),
		finderBp: z.number().int().min(1).max(10_000),
	}),
	z.object({
		ruleType: z.literal(SplitRuleType.enum.benevolent_dictator),
	}),
]);
export type SplitRuleInput = z.infer<typeof SplitRuleInputSchema>;

/**
 * The team's payout policy — the split editor's whole state. Present on the console detail ONLY for a
 * viewer holding `manage_finances` (Decision #233); everybody else reads `null`.
 */
export const TeamPayoutPolicySchema = z.object({
	/** The vault wallet the figures below are read from (the treasury wallet, else the fullest). */
	walletId: z.string().max(64).nullable(),
	/**
	 * ISO 4217 code of the vault wallet — the unit of {@link availableMinor} and {@link pendingMinor}.
	 * (The projection's MoneyViews carry their own currency: the held release's, when one is held.)
	 */
	currency: z.string().regex(/^[A-Z]{3}$/),
	/** The vault's spendable balance, integer minor units of {@link currency}. */
	availableMinor: z.number().int().min(0),
	/** Releases still clearing into the vault, integer minor units of {@link currency}. */
	pendingMinor: z.number().int().min(0),
	model: SplitModel,
	stakes: z.array(SplitStakeSchema),
	templates: z.array(SplitTemplateSchema),
	/**
	 * The release this projection is priced against — the team's oldest escrow still held, so the
	 * editor shows real consequences ("Ravi receives £412.50 of the next release") rather than abstract
	 * percentages. `null` when nothing is held: no release is coming, and none is invented.
	 */
	projectedRelease: MoneyViewSchema.nullable(),
	/** Platform fee already deducted from {@link projectedRelease} (server-computed, display only). */
	platformFee: MoneyViewSchema.nullable(),
	/** The vault's cut of every release, in basis points, taken before the members' split. */
	vaultBp: z.number().int().min(0).max(10_000),
	/** The active split template the release plan applies before the stakes. */
	rule: TeamSplitRuleSchema,
	/** What the vault keeps of the projected release — its cut plus the rounding dust. */
	vaultCut: MoneyViewSchema.nullable(),
	/** Who may withdraw from the vault — member ids. */
	withdrawApprovers: z.array(z.string().max(64)),
});
export type TeamPayoutPolicy = z.infer<typeof TeamPayoutPolicySchema>;

/** Whether a set of stakes forms a valid split (sums to exactly 100%). */
export function splitIsBalanced(stakes: readonly { shareBp: number }[]): boolean {
	return stakes.reduce((sum, s) => sum + s.shareBp, 0) === 10_000;
}

/** The signed drift from a balanced split, in basis points — what the editor must show and fix. */
export function splitDriftBp(stakes: readonly { shareBp: number }[]): number {
	return stakes.reduce((sum, s) => sum + s.shareBp, 0) - 10_000;
}

/**
 * Rebalance after a single stake moves, holding the 100% invariant by absorbing the delta across the
 * OTHER unheld stakes in proportion to their current size.
 *
 * Pure and total: it never produces a negative share, and any integer remainder from the proportional
 * division is pushed onto the largest absorbing stake so the result sums to exactly 10 000 — the bar
 * can therefore never render a phantom gap. Held stakes are immovable, which is the point of holding
 * one; if every other stake is held the move is refused by returning the input unchanged.
 */
export function rebalanceSplit(
	stakes: readonly SplitStake[],
	memberId: string,
	nextBp: number,
): SplitStake[] {
	const idx = stakes.findIndex((s) => s.memberId === memberId);
	if (idx < 0) return [...stakes];

	const target = Math.max(0, Math.min(10_000, Math.round(nextBp)));
	const absorbers = stakes.filter((s, i) => i !== idx && !s.held);
	if (absorbers.length === 0) return [...stakes];

	const absorbTotal = absorbers.reduce((sum, s) => sum + s.shareBp, 0);
	const heldTotal = stakes.filter((s, i) => i !== idx && s.held).reduce((n, s) => n + s.shareBp, 0);
	// The moving stake can never claim more than what the unheld stakes can give up.
	const capped = Math.min(target, 10_000 - heldTotal);
	const remaining = 10_000 - heldTotal - capped;

	const next = stakes.map((s, i) => {
		if (i === idx) return { ...s, shareBp: capped };
		if (s.held) return { ...s };
		// Proportional absorption; an all-zero absorber set splits the remainder evenly.
		const share = absorbTotal > 0
			? Math.floor((s.shareBp / absorbTotal) * remaining)
			: Math.floor(remaining / absorbers.length);
		return { ...s, shareBp: Math.max(0, share) };
	});

	// Push any rounding remainder onto the largest absorber so the total is exact.
	const drift = splitDriftBp(next);
	if (drift !== 0) {
		let biggest = -1;
		for (let i = 0; i < next.length; i++) {
			if (i === idx || next[i].held) continue;
			if (biggest < 0 || next[i].shareBp > next[biggest].shareBp) biggest = i;
		}
		if (biggest >= 0) next[biggest] = { ...next[biggest], shareBp: next[biggest].shareBp - drift };
	}
	return next;
}
// #endregion

// #region Business — money in from members, out as purchases
/** A single movement into or out of the pooled wallet. */
export const PoolEntrySchema = z.object({
	id: z.string().max(64),
	/** `contribution` funds the pool; `spend` draws from it. */
	kind: z.enum(["contribution", "spend"]),
	/**
	 * Who did it. A contribution is always attributed (`finance.ledger_audit`); a spend is attributed
	 * only when the money path recorded an actor, and `null` — rendered as the business itself — when it
	 * did not, rather than guessed.
	 */
	memberId: z.string().max(64).nullable(),
	handle: z.string().max(40).nullable(),
	name: z.string().max(120).nullable(),
	avatar: z.string().max(400).nullable(),
	amount: MoneyViewSchema,
	/** What it was for ("Aurora rebrand — stage 2"). */
	reason: z.string().max(160),
	/** Pre-formatted date ("12 Aug"). */
	at: z.string().max(40),
	/** Set when this movement needed an approval, naming who granted it. */
	approvedBy: z.string().max(120).nullable().default(null),
});
export type PoolEntry = z.infer<typeof PoolEntrySchema>;

/** A spend request raised because a purchase exceeded the requester's limit. */
export const SpendRequestSchema = z.object({
	id: z.string().max(64),
	memberId: z.string().max(64),
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	amount: MoneyViewSchema,
	reason: z.string().max(160),
	state: z.enum(["pending", "approved", "declined", "expired"]),
	raisedAt: z.string().max(40),
	/** Who must decide — resolved names, so the requester sees a person not an id. */
	approvers: z.array(z.string().max(120)),
	/** Set once decided. */
	decidedBy: z.string().max(120).nullable().default(null),
	decidedAt: z.string().max(40).nullable().default(null),
});
export type SpendRequest = z.infer<typeof SpendRequestSchema>;

/**
 * How a rolling ceiling resets (`finance.spending_limits.period_interval`): at the start of each ISO
 * week, each calendar month, or never (`total` — a lifetime allowance).
 */
export const SpendPeriod = z.enum(["weekly", "monthly", "total"]);
export type SpendPeriod = z.infer<typeof SpendPeriod>;

/**
 * One member's spend envelope on the policy wallet. Every figure is the DATABASE's: `spentMinor` is
 * what the spend gate (`finance.fn_check_spending_limit`) would count right now — `0` once the period
 * has rolled — and `remainingMinor` / `usedFraction` are derived from it in SQL, so a meter never
 * divides on the client.
 */
export const SpendLimitSchema = z.object({
	memberId: z.string().max(64),
	/** The member's `@handle` (without the `@`). */
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	/** Whether they may spend at all (`spend_funds`). */
	canSpend: z.boolean(),
	/** Rolling ceiling (the cap) in minor units, or `null` for no ceiling. */
	limitMinor: z.number().int().min(0).nullable(),
	/** Pre-formatted ceiling for display; `null` with no ceiling. */
	limit: MoneyViewSchema.nullable(),
	/** The period the ceiling rolls over. */
	period: SpendPeriod.default("monthly"),
	/** Spent within the current period, in minor units. */
	spentMinor: z.number().int().min(0).default(0),
	/** Spent within the current period (server-formatted). */
	spent: MoneyViewSchema,
	/** What is left of the ceiling this period (never below 0); `null` with no ceiling. */
	remainingMinor: z.number().int().min(0).nullable().default(null),
	/** Fraction of the ceiling consumed, 0–1 — drives the envelope meter without client division. */
	usedFraction: z.number().min(0).max(1),
	/** Per-transaction ceiling, or `null`. */
	perTransactionMinor: z.number().int().min(0).nullable(),
});
export type SpendLimit = z.infer<typeof SpendLimitSchema>;

/**
 * The spend requests a viewer may see (their own; every request for an approver or a policy manager),
 * split so the queue and its history render without client filtering. `decided` is the 30 most
 * recent approved, declined or expired requests.
 */
export const SpendApprovalsSchema = z.object({
	pending: z.array(SpendRequestSchema),
	decided: z.array(SpendRequestSchema),
});
export type SpendApprovals = z.infer<typeof SpendApprovalsSchema>;

/** The business's spend policy — the buyer-side editor's whole state. */
export const BusinessSpendPolicySchema = z.object({
	/** The wallet currency this policy governs (a threshold and a limit are amounts in ONE currency). */
	currency: z.string().regex(/^[A-Z]{3}$/),
	/**
	 * The wallet's OWN threshold — spend at or above it needs an approval. `null` means no local
	 * override: the platform default ({@link platformThresholdMinor}) governs instead.
	 */
	approvalThresholdMinor: z.number().int().min(1).nullable(),
	approvalThreshold: MoneyViewSchema.nullable(),
	/**
	 * The platform's `vault_approval_threshold_cents` — what the spend gate applies while
	 * {@link approvalThresholdMinor} is `null`; `null` when the platform sets none either.
	 */
	platformThresholdMinor: z.number().int().min(1).nullable().default(null),
	/** Member ids who may approve (`approve_spend`). */
	approverIds: z.array(z.string().max(64)),
	/** The same approvers by `@handle`, in the same order. */
	approverHandles: z.array(z.string().max(40)).default([]),
	/**
	 * Per-member envelopes. A viewer who may read the wallet's envelopes
	 * (`finance.fn_reads_wallet_envelopes`) receives every member's; anybody else only their own.
	 */
	limits: z.array(SpendLimitSchema),
	/** Who may top the pool up (`contribute_funds`) — member ids. */
	contributorIds: z.array(z.string().max(64)),
	/** The same contributors by `@handle`, in the same order. */
	contributorHandles: z.array(z.string().max(40)).default([]),
	/** The attributable ledger. */
	entries: z.array(PoolEntrySchema),
	/** The spend requests the viewer may see — the pending queue and its recent history. */
	approvals: SpendApprovalsSchema,
	/**
	 * KYB state. The pooled wallet cannot be OPERATED until verified — the pre-verified surface is an
	 * actionable lock with the policy editor still usable, never a dead end (brief §8).
	 */
	verification: VerificationState,
	/** What the viewer must do to clear the lock; `null` once verified. */
	verificationPrompt: z.string().max(200).nullable(),
});
export type BusinessSpendPolicy = z.infer<typeof BusinessSpendPolicySchema>;

/**
 * What the viewer may do on a business console, decided in SQL from their effective capabilities and
 * the business's lifecycle and KYB — the same conditions the write doors enforce, so the screens
 * render from these and never recompute policy.
 */
export const BusinessViewerCanSchema = z.object({
	/** Edit the spend policy (`manage_finances`). */
	editPolicy: z.boolean(),
	/** Approve or decline a spend request (`approve_spend`, KYB verified). */
	decide: z.boolean(),
	/** File a spend request (vault `spend`, business active). */
	requestSpend: z.boolean(),
	/** Pay an invoice (`manage_billing`, KYB verified, business active). */
	payInvoice: z.boolean(),
	/** Start or resume KYB (`manage_billing`). */
	startKyb: z.boolean(),
	/** Hire onto the business's projects (`hire`, business active). */
	hire: z.boolean(),
	/** Place an order from the pooled wallet (`purchase` and vault `spend`, KYB verified, active). */
	purchase: z.boolean(),
	/** Create and run the business's projects (`manage_projects`, business active). */
	manageProjects: z.boolean(),
	/** Archive the business now (`archive_entity`, not archived, no archive blocker). */
	archive: z.boolean(),
});
export type BusinessViewerCan = z.infer<typeof BusinessViewerCanSchema>;

/**
 * What still stands between a business and a verified KYB, as stable codes the screen words:
 * `connect_account` — no Stripe Connect account exists yet (start onboarding);
 * `finish_onboarding` — the account exists but the provider has not verified it;
 * `provider_restricted` — the provider restricted or disabled the account;
 * `kyb_rejected` / `kyb_expired` — the platform's KYB record says so.
 * The provider's own field-level requirement list is not stored, so it is not invented here.
 */
export const KybRequirement = z.enum([
	"connect_account",
	"finish_onboarding",
	"provider_restricted",
	"kyb_rejected",
	"kyb_expired",
]);
export type KybRequirement = z.infer<typeof KybRequirement>;

/** A business's KYB picture for the Verification module and every lock that links to it. */
export const BusinessKybSchema = z.object({
	status: VerificationState,
	/** ISO instant the business was verified, or `null`. */
	verifiedAt: z.string().max(40).nullable(),
	/**
	 * Resume Stripe-hosted onboarding for the business's EXISTING Connect account (the refresh door,
	 * which mints a fresh single-use link and redirects) — present only for a `startKyb` holder whose
	 * business has an account. Without one, onboarding starts at `POST /api/finance/verify/kyb`.
	 */
	connectOnboardingUrl: z.string().max(300).nullable(),
	requirementsDue: z.array(KybRequirement),
	/**
	 * Whether the payment processor that runs the check is connected in this environment. Without it
	 * neither door can reach Stripe, so the module offers no action and says why (Decision #225 (B)).
	 */
	processorConnected: z.boolean().default(false),
});
export type BusinessKyb = z.infer<typeof BusinessKybSchema>;

/**
 * One currency's money tiles for a business, every figure summed in SQL in that currency (no
 * conversion): `available` — the wallet balance; `pending` — releases still clearing back into it;
 * `committed` — escrow the business has funded and not yet released; `awaitingApproval` — open spend
 * requests; `spent30d` — debits of the last 30 days other than transfers out.
 */
export const BusinessMoneyTileSchema = z.object({
	currency: z.string().regex(/^[A-Z]{3}$/),
	available: MoneyViewSchema,
	pending: MoneyViewSchema,
	committed: MoneyViewSchema,
	awaitingApproval: MoneyViewSchema,
	spent30d: MoneyViewSchema,
});
export type BusinessMoneyTile = z.infer<typeof BusinessMoneyTileSchema>;

/**
 * `finance.preview_spend_envelope`'s answer — the envelopes a draft policy patch WOULD produce, so a
 * draft ceiling never renders against the stored figures it is about to replace. Nothing is written.
 */
export const SpendEnvelopePreviewSchema = z.object({
	currency: z.string().regex(/^[A-Z]{3}$/),
	limits: z.array(SpendLimitSchema),
});
export type SpendEnvelopePreview = z.infer<typeof SpendEnvelopePreviewSchema>;

/**
 * Whether a spend of `amountMinor` by a member clears their envelope, and if not, why.
 *
 * Returns a **routable outcome**, never a bare refusal: a blocked purchase must always offer the
 * request path (brief §8), so `needs_approval` is a first-class result rather than a failure.
 */
export type SpendVerdict =
	| { outcome: "allowed" }
	| { outcome: "needs_approval"; reason: string }
	| { outcome: "blocked"; reason: string };

/** Decide a spend against a member's limit and the entity's approval threshold. */
export function evaluateSpend(
	amountMinor: number,
	limit: Pick<SpendLimit, "canSpend" | "limitMinor" | "perTransactionMinor"> | undefined,
	policy: Pick<BusinessSpendPolicy, "approvalThresholdMinor" | "verification">,
): SpendVerdict {
	if (policy.verification !== "verified") {
		return { outcome: "blocked", reason: "The pooled wallet is locked until verification clears." };
	}
	if (!limit || !limit.canSpend) {
		return { outcome: "blocked", reason: "You do not have permission to spend from this wallet." };
	}
	if (limit.perTransactionMinor !== null && amountMinor > limit.perTransactionMinor) {
		return { outcome: "needs_approval", reason: "Above your per-transaction ceiling." };
	}
	if (limit.limitMinor !== null && amountMinor > limit.limitMinor) {
		return { outcome: "needs_approval", reason: "Above your remaining spend limit." };
	}
	if (policy.approvalThresholdMinor !== null && amountMinor >= policy.approvalThresholdMinor) {
		return { outcome: "needs_approval", reason: "At or above the approval threshold." };
	}
	return { outcome: "allowed" };
}
// #endregion
