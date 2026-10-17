import type { WorkspaceCapability, WorkspaceKind } from "./common.ts";

/**
 * access — **which money and admin screens a viewer may open**, as predicates over their
 * server-resolved effective capabilities (`WorkspaceDetail.viewerCapabilities`).
 *
 * The module registry gates its Spend, Finance, Billing and Verification modules on these, and the
 * Overview bands (BU6) and the console read model (BB9) ask the same functions, so a module and its
 * Overview band never disagree about the same viewer. Pure: no DOM, no database — the app, the
 * backend and the tests all import it.
 *
 * Why predicates and not one capability each (BUSINESSES_AUDIT BF29, BF30): a business's Spend is
 * opened by three different people — a spender (their own envelope), an approver (the queue) and the
 * policy editor — and gating it on `spend_funds` alone left an approve-only role unable to reach the
 * queue it exists to work.
 */

// #region Module gates
/** A capability set's membership test — the one shape every gate below is written against. */
const holds = (caps: readonly WorkspaceCapability[], ...any: WorkspaceCapability[]): boolean =>
	any.some((c) => caps.includes(c));

/**
 * Finance. A team's is the earnings summary (`manage_finances`); a business's is the pooled wallet,
 * open to anyone who pays into it, spends from it or runs it.
 */
export function canOpenFinance(kind: WorkspaceKind, caps: readonly WorkspaceCapability[]): boolean {
	return kind === "team"
		? holds(caps, "manage_finances")
		: holds(caps, "contribute_funds", "spend_funds", "manage_finances");
}

/** Spend (business): a spender, the policy editor, or an approver. */
export function canOpenSpend(_kind: WorkspaceKind, caps: readonly WorkspaceCapability[]): boolean {
	return holds(caps, "spend_funds", "manage_finances", "approve_spend");
}

/** Billing (business): the billing right — the owner's, or an admin's by the owner's grant. */
export function canOpenBilling(
	_kind: WorkspaceKind,
	caps: readonly WorkspaceCapability[],
): boolean {
	return holds(caps, "manage_billing");
}

/**
 * Verification. A business's KYB is started by the billing right (Decision #230 (d)); a team's
 * verification follows its settings.
 */
export function canOpenVerification(
	kind: WorkspaceKind,
	caps: readonly WorkspaceCapability[],
): boolean {
	return kind === "business" ? holds(caps, "manage_billing") : holds(caps, "manage_settings");
}
// #endregion

// #region Inside Spend
/** What a viewer who may open Spend sees there. */
export interface SpendAccess {
	/** Their own spend envelope and their own requests. */
	envelope: boolean;
	/** Every member's envelope and the whole request queue (the RLS twin: `fn_reads_wallet_envelopes`). */
	queue: boolean;
	/** Approve or reject a queued request. */
	decide: boolean;
	/** Edit the limits and the approval threshold. */
	editor: boolean;
}

/** The Spend module's sections for a viewer — an approve-only role gets the queue, not the editor. */
export function spendAccess(caps: readonly WorkspaceCapability[]): SpendAccess {
	return {
		envelope: holds(caps, "spend_funds"),
		queue: holds(caps, "approve_spend", "manage_finances"),
		decide: holds(caps, "approve_spend"),
		editor: holds(caps, "manage_finances"),
	};
}
// #endregion
