import { z } from "zod";
import {
	basisPoints,
	currency,
	minorUnits,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
	uuid,
} from "./common.ts";

/**
 * finance vault governance — capability grants, spending caps, team split rulesets, spend approvals,
 * and the money audit trail. Mirrors migration 20260723093000 plus the EXISTING
 * `finance.spending_limits` (migration 0009).
 *
 * Reuses (does not fork): per-member caps are `finance.spending_limits`; per-member split shares are
 * `finance.contribution_agreements` (see ledger.ts). {@link SplitRuleSchema} adds the RULESET TEMPLATE
 * that resolves into those per-member rows. ⚠️ The capability set overlaps `org.business_permission` /
 * `org.team_permission` — flagged for human reconciliation (root CLAUDE.md §8).
 */

// #region Vault capability grants
/** `finance.vault_capability` — a fine-grained money capability on a shared wallet. */
export const VaultCapability = z.enum([
	"view",
	"add_funds",
	"spend",
	"distribute",
	"withdraw",
	"manage_members",
	"manage_billing",
]);
export type VaultCapability = z.infer<typeof VaultCapability>;

/** A row of `finance.vault_permissions` — the capability SET a member holds on a wallet. */
export const VaultPermissionSchema = z.object({
	id: uuid,
	walletId: uuid,
	memberUserId: uuid,
	capabilities: z.array(VaultCapability),
	grantedBy: uuid.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type VaultPermission = z.infer<typeof VaultPermissionSchema>;
// #endregion

// #region Spending caps (existing finance.spending_limits)
/** The reset cadence a spending cap is measured over. */
export const SpendingLimitInterval = z.enum(["weekly", "monthly", "total"]);
export type SpendingLimitInterval = z.infer<typeof SpendingLimitInterval>;

/** A row of `finance.spending_limits` — a per-member cap on a (pooled) wallet (migration 0009). */
export const SpendingLimitSchema = z.object({
	id: uuid,
	walletId: uuid,
	memberUserId: uuid,
	capCents: minorUnitsNonNeg,
	periodInterval: SpendingLimitInterval,
	spentCents: minorUnitsNonNeg,
	resetsAt: timestamp.nullable(),
});
export type SpendingLimit = z.infer<typeof SpendingLimitSchema>;
// #endregion

// #region Team split rulesets
/** `finance.split_rule_type` — the three default team payout templates (finance-model.md §5). */
export const SplitRuleType = z.enum(["co_op", "finders_fee", "benevolent_dictator"]);
export type SplitRuleType = z.infer<typeof SplitRuleType>;

/**
 * A row of `finance.split_rules` — the ruleset template. `vaultBp` is the Team Vault cut taken first;
 * the remainder splits per the template. Deterministic remainder rounding sends any leftover minor
 * unit to the Team Vault so the ledger sums to zero.
 */
export const SplitRuleSchema = z.object({
	id: uuid,
	teamId: uuid,
	ruleType: SplitRuleType,
	vaultBp: basisPoints,
	finderUserId: uuid.nullable(),
	finderBp: basisPoints.nullable(),
	active: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type SplitRule = z.infer<typeof SplitRuleSchema>;
// #endregion

// #region Spend approvals (over-cap second sign-off)
/** `finance.approval_status`. */
export const ApprovalStatus = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** A row of `finance.spend_approvals` — a queued over-cap/over-threshold spend awaiting a 2nd approver. */
export const SpendApprovalSchema = z.object({
	id: uuid,
	walletId: uuid,
	requestedBy: uuid,
	amountCents: minorUnitsPositive,
	currency,
	reason: z.string().min(1).max(2000),
	refTable: z.string().max(80).nullable(),
	refId: uuid.nullable(),
	status: ApprovalStatus,
	approverUserId: uuid.nullable(),
	decidedAt: timestamp.nullable(),
	expiresAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type SpendApproval = z.infer<typeof SpendApprovalSchema>;
// #endregion

// #region Money audit trail
/** `finance.vault_action` — the money-move actions the audit trail records. */
export const VaultAction = z.enum(["add_funds", "spend", "distribute", "withdraw", "transfer"]);
export type VaultAction = z.infer<typeof VaultAction>;

/** A row of `finance.ledger_audit` — an immutable who/when/amount record for a vault money move. */
export const LedgerAuditSchema = z.object({
	id: uuid,
	walletId: uuid,
	actorUserId: uuid.nullable(),
	action: VaultAction,
	amountCents: minorUnits,
	currency,
	refTable: z.string().max(80).nullable(),
	refId: uuid.nullable(),
	metadata: z.record(z.string(), z.unknown()),
	createdAt: timestamp,
});
export type LedgerAudit = z.infer<typeof LedgerAuditSchema>;
// #endregion
