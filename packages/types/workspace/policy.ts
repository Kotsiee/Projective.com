import { z } from "zod";
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
 * How a released payout divides. `equal` and `by_role` are computed server-side from the roster;
 * `custom` honours each member's `shareBp`. Modelled as a template rather than a boolean so a team can
 * change policy without rewriting every member's share.
 */
export const SplitModel = z.enum(["equal", "by_role", "custom"]);
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

/** A named, reusable split template (`finance.split_rules` is the eventual live backing). */
export const SplitTemplateSchema = z.object({
	id: z.string().max(64),
	name: z.string().min(1).max(64),
	model: SplitModel,
	stakes: z.array(SplitStakeSchema),
	/** Whether this is the template applied to new releases. */
	isDefault: z.boolean().default(false),
});
export type SplitTemplate = z.infer<typeof SplitTemplateSchema>;

/** The team's payout policy — the split editor's whole state. */
export const TeamPayoutPolicySchema = z.object({
	model: SplitModel,
	stakes: z.array(SplitStakeSchema),
	templates: z.array(SplitTemplateSchema),
	/**
	 * The release this projection is priced against — so the editor shows real consequences ("Ravi
	 * receives £412.50 of the next release") rather than abstract percentages.
	 */
	projectedRelease: MoneyViewSchema,
	/** Platform fee already deducted from {@link projectedRelease} (server-computed, display only). */
	platformFee: MoneyViewSchema,
	/** Who may request a withdrawal — member ids. */
	withdrawApprovers: z.array(z.string().max(64)),
	/** Whether releases distribute automatically or wait for a manual push. */
	autoDistribute: z.boolean(),
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
/** A single attributable movement into or out of the pooled wallet. */
export const PoolEntrySchema = z.object({
	id: z.string().max(64),
	/** `contribution` funds the pool; `spend` draws from it. */
	kind: z.enum(["contribution", "spend"]),
	/** Who did it — a pooled wallet without attribution is a dispute waiting to happen (brief §8). */
	memberId: z.string().max(64),
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
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
	state: z.enum(["pending", "approved", "declined"]),
	raisedAt: z.string().max(40),
	/** Who must decide — resolved names, so the requester sees a person not an id. */
	approvers: z.array(z.string().max(120)),
	/** Set once decided. */
	decidedBy: z.string().max(120).nullable().default(null),
	decidedAt: z.string().max(40).nullable().default(null),
});
export type SpendRequest = z.infer<typeof SpendRequestSchema>;

/** One member's spend envelope. */
export const SpendLimitSchema = z.object({
	memberId: z.string().max(64),
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	/** Whether they may spend at all. */
	canSpend: z.boolean(),
	/** Rolling ceiling in minor units, or `null` for unlimited (owners). */
	limitMinor: z.number().int().min(0).nullable(),
	/** Pre-formatted ceiling for display. */
	limit: MoneyViewSchema.nullable(),
	/** Spent within the current period (server-computed). */
	spent: MoneyViewSchema,
	/** Fraction of the ceiling consumed, 0–1 — drives the envelope meter without client division. */
	usedFraction: z.number().min(0).max(1),
	/** Per-transaction ceiling, or `null`. */
	perTransactionMinor: z.number().int().min(0).nullable(),
});
export type SpendLimit = z.infer<typeof SpendLimitSchema>;

/** The business's spend policy — the buyer-side editor's whole state. */
export const BusinessSpendPolicySchema = z.object({
	/** Spend at or above this needs an approval. `null` disables the ladder entirely. */
	approvalThresholdMinor: z.number().int().min(0).nullable(),
	approvalThreshold: MoneyViewSchema.nullable(),
	/** Member ids who may approve. */
	approverIds: z.array(z.string().max(64)),
	/** Per-member envelopes. */
	limits: z.array(SpendLimitSchema),
	/** Who may top the pool up. */
	contributorIds: z.array(z.string().max(64)),
	/** The attributable ledger. */
	entries: z.array(PoolEntrySchema),
	/** Outstanding + recently-decided requests. */
	requests: z.array(SpendRequestSchema),
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
