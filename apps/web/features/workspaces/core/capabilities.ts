import {
	capabilitiesForKind,
	type CellState,
	CONSEQUENTIAL,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceKind,
} from "@projective/types/workspace";

/**
 * capabilities — the ONE capability grouping and the conditional-rule reading every permission surface
 * shares: the member drawer's switch groups, the roles matrix's row groups and the role editor's
 * columns. Six copies of a grouping is how a matrix and a drawer start teaching two different mental
 * models of the same permission system, so it lives here once.
 *
 * Pure: no preact, no CSS, no network — `deno test` reads it directly.
 */

// #region Grouping
/** A named run of capabilities — the matrix's row groups, the role editor's columns, the drawer's groups. */
export interface CapabilityGroup {
	/** Heading, sentence case. */
	title: string;
	capabilities: readonly WorkspaceCapability[];
}

/**
 * Every capability, grouped by what it governs. The groups mirror the SSOT enum's own runs, so a
 * capability added there falls into an obvious slot here. {@link capabilityGroupsFor} scopes them to a
 * kind, which is why the union covers every capability although neither kind renders all of them.
 */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
	{ title: "Membership", capabilities: ["invite_members", "remove_members", "manage_roles"] },
	{ title: "Identity", capabilities: ["edit_profile", "manage_settings"] },
	{ title: "Delivery", capabilities: ["bind_seat", "manage_projects", "publish_listings"] },
	{ title: "Commerce", capabilities: ["purchase", "hire"] },
	{
		title: "Money",
		capabilities: [
			"contribute_funds",
			"spend_funds",
			"withdraw_funds",
			"manage_finances",
			"approve_spend",
			"manage_billing",
		],
	},
	{ title: "Oversight", capabilities: ["view_analytics", "view_audit"] },
	{ title: "Terminal", capabilities: ["archive_entity"] },
];

/**
 * The capability groups a kind renders, kind-excluded capabilities dropped and empty groups removed —
 * a heading over nothing tells the reader something is being withheld.
 */
export function capabilityGroupsFor(kind: WorkspaceKind): CapabilityGroup[] {
	const allowed = new Set(capabilitiesForKind(kind));
	return CAPABILITY_GROUPS
		.map((group) => ({
			title: group.title,
			capabilities: group.capabilities.filter((c) => allowed.has(c)),
		}))
		.filter((group) => group.capabilities.length > 0);
}

/** Whether a capability's consequences are severe enough to be surfaced rather than merely listed. */
export function isConsequential(capability: WorkspaceCapability): boolean {
	return CONSEQUENTIAL.includes(capability);
}
// #endregion

// #region Conditional rules
/** The slice of the detail projection the conditional rules read. */
export type PolicyContext = Pick<WorkspaceDetail, "kind" | "payout" | "spend" | "canPropose">;

/**
 * The written rule that bounds a granted capability, or `null` when the grant is unqualified.
 *
 * `conditional` is not "half allowed" — it means the capability applies only under a rule the entity
 * has actually configured, and the rule is the cell's tooltip. Every rule is read from server state on
 * the detail projection, never invented: a spend ladder the business set up, a withdrawal approver list
 * the team nominated, the two-member floor a one-person team has not cleared yet.
 */
export function conditionalRuleFor(
	capability: WorkspaceCapability,
	workspace: PolicyContext,
): string | null {
	if (capability === "spend_funds") {
		const threshold = workspace.spend?.approvalThreshold?.display;
		return threshold ? `Spending at or above ${threshold} needs an approver's sign-off.` : null;
	}
	if (capability === "withdraw_funds") {
		return (workspace.payout?.withdrawApprovers.length ?? 0) > 0
			? "A withdrawal needs a nominated approver's sign-off before it leaves the vault."
			: null;
	}
	if (capability === "bind_seat" && workspace.canPropose === false) {
		return "The team needs at least two active members before it can bid for a seat.";
	}
	return null;
}

/**
 * The tri-state a cell or a permission row renders: `denied` when the capability is not granted at
 * all, `conditional` when it is granted but bounded by a configured rule, else `allowed`.
 */
export function cellStateFor(
	granted: boolean,
	capability: WorkspaceCapability,
	workspace: PolicyContext,
): CellState {
	if (!granted) return "denied";
	return conditionalRuleFor(capability, workspace) === null ? "allowed" : "conditional";
}
// #endregion
