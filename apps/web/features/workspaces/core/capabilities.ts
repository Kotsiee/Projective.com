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
 * shares: the member drawer's switch groups and the Roles screen's capability domains. Two copies of a
 * grouping is how a roles screen and a drawer start teaching two different mental models of the same
 * permission system, so it lives here once.
 *
 * Pure: no preact, no CSS, no network — `deno test` reads it directly.
 */

// #region Grouping
/** Which domain a capability group is — stable across kinds, whatever the heading says. */
export type CapabilityDomain = "people" | "work" | "money" | "admin";

/** A domain's heading and one-line remit, worded for one kind. */
export interface DomainCopy {
	/** Heading, sentence case. */
	title: string;
	/** What the domain governs, in one line (meta register). */
	description: string;
}

/** A named run of capabilities — the Roles screen's domains, the drawer's switch groups. */
export interface CapabilityGroup extends DomainCopy {
	key: CapabilityDomain;
	capabilities: readonly WorkspaceCapability[];
}

/** One domain of {@link CAPABILITY_GROUPS}: its capabilities and its copy per kind. */
interface DomainDef {
	key: CapabilityDomain;
	copy: Readonly<Record<WorkspaceKind, DomainCopy>>;
	capabilities: readonly WorkspaceCapability[];
}

/**
 * Every capability, grouped by what it governs (Decision #320, refining #264 (b)'s People · Work ·
 * Money · Admin): **People & access**, then the work the entity commits to (**Projects & delivery** on
 * a team, **Projects & purchasing** on a business), then the money it may move (**Vault** or
 * **Wallet & financial governance**), then the entity-level administration that remains
 * (**Workspace & oversight**). Four domains a reader can hold in their head, in the order a role is
 * usually reasoned about. {@link capabilityGroupsFor} scopes them to a kind, which is why the union
 * covers every capability although neither kind renders all of them. A capability added to the SSOT
 * enum must be added to exactly one domain here (`roles-model.test.ts` holds that).
 */
const DOMAINS: readonly DomainDef[] = [
	{
		key: "people",
		copy: {
			team: {
				title: "People & access",
				description: "Who joins the team, who leaves, and who decides what everyone may do.",
			},
			business: {
				title: "People & access",
				description: "Who joins the business, who leaves, and who decides what everyone may do.",
			},
		},
		capabilities: ["invite_members", "remove_members", "manage_roles"],
	},
	{
		key: "work",
		copy: {
			team: {
				title: "Projects & delivery",
				description: "The work the team commits to and what it puts on sale.",
			},
			business: {
				title: "Projects & purchasing",
				description: "The projects the business commissions, and who it hires and buys from.",
			},
		},
		capabilities: ["bind_seat", "manage_projects", "publish_listings", "purchase", "hire"],
	},
	{
		key: "money",
		copy: {
			team: {
				title: "Vault & financial governance",
				description: "How money leaves the vault and how earnings are split.",
			},
			business: {
				title: "Wallet & financial governance",
				description: "How money enters and leaves the pooled wallet, and who signs it off.",
			},
		},
		capabilities: [
			"contribute_funds",
			"spend_funds",
			"withdraw_funds",
			"manage_finances",
			"approve_spend",
			"manage_billing",
		],
	},
	{
		key: "admin",
		copy: {
			team: {
				title: "Workspace & oversight",
				description: "The team's public identity, its settings and its records.",
			},
			business: {
				title: "Workspace & oversight",
				description: "The business's public identity, its settings and its records.",
			},
		},
		capabilities: [
			"edit_profile",
			"manage_settings",
			"view_analytics",
			"view_audit",
			"archive_entity",
		],
	},
];

/** Every domain with its team wording — the kind-free list a test walks for coverage. */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = DOMAINS.map((d) => ({
	key: d.key,
	...d.copy.team,
	capabilities: d.capabilities,
}));

/**
 * The capability groups a kind renders, worded for that kind, kind-excluded capabilities dropped and
 * empty groups removed — a heading over nothing tells the reader something is being withheld.
 */
export function capabilityGroupsFor(kind: WorkspaceKind): CapabilityGroup[] {
	const allowed = new Set(capabilitiesForKind(kind));
	return DOMAINS
		.map((d) => ({
			key: d.key,
			...d.copy[kind],
			capabilities: d.capabilities.filter((c) => allowed.has(c)),
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
