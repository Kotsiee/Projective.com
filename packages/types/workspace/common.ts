import { z } from "zod";

/**
 * workspace/common — the shared vocabulary of the multi-member entity surface (`/teams`,
 * `/businesses`).
 *
 * **The mental model this whole domain encodes:** a **Team is a Freelancer with multiple members**
 * (seller side) and a **Business is a Client with multiple members** (buyer side). An entity is not a
 * new persona — it is an existing one made multi-seat. Everything that differs between the two kinds
 * is expressed as a **capability table** here, never as a forked schema, so one architecture serves
 * both (root CLAUDE.md §8 Decision #61 · brief §2).
 *
 * These are **read/write projections** for the console surface, not table mirrors: the live path
 * reads the existing `org.teams` / `org.business_profiles` / `org.*_members` / `org.*_roles` tables,
 * so no migration accompanies them (contrast `org/organisations.ts`, which mirrors migration 0314
 * column-for-column). That is why they live under their own `@projective/types/workspace` sub-path
 * rather than polluting the DB-row `org` namespace.
 *
 * Only regex/min/max/enum/array primitives are used, so the schemas stay stable across Zod majors.
 */

// #region Entity vocabulary
/**
 * Which side of the market the entity sits on. This single discriminator parameterises the entire
 * surface — routes, lane modules, capability sets, money semantics and nav gating all derive from it.
 */
export const WorkspaceKind = z.enum(["team", "business"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;

/**
 * Lifecycle state. Nothing is ever hard-deleted (root CLAUDE.md §5) — an entity the owner is done
 * with becomes `archived` and can be restored. `draft` is the Draft-First creation state: created
 * from name + handle alone, fully usable, with an inline checklist inviting the rest.
 */
export const WorkspaceStatus = z.enum(["draft", "active", "archived"]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatus>;

/**
 * Identity-verification state. A **team** verifies its members' identity (KYC) to receive payouts; a
 * **business** verifies the company (KYB) to *operate* its pooled wallet. Both ladder through the same
 * three states so one lock component serves both — the copy differs, the machine does not.
 */
export const VerificationState = z.enum(["unverified", "pending", "verified"]);
export type VerificationState = z.infer<typeof VerificationState>;

/**
 * A member's authority. These are **preset roles** — named bundles of {@link WorkspaceCapability}
 * (layer 1 of the three-layer model, brief §8). `lead` is team-only (it carries the seat-binding
 * authority `projects.apply_to_seat` enforces); a business roster uses owner/admin/member.
 *
 * Ordered most- to least- privileged; {@link roleRank} depends on that order.
 */
export const WorkspaceRole = z.enum(["owner", "admin", "lead", "member"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

/**
 * Where a person stands relative to the entity. `invited` (we asked them) and `requested` (they asked
 * us) are deliberately distinct states rather than one "pending" — they route to opposite actions, and
 * collapsing them would make the invitation inbox lie about who owes whom a decision.
 */
export const MembershipState = z.enum(["active", "invited", "requested", "left"]);
export type MembershipState = z.infer<typeof MembershipState>;
// #endregion

// #region Capability vocabulary
/**
 * The permission vocabulary — the columns of the roles matrix and the atoms a per-member override
 * grants or revokes.
 *
 * Deliberately **one flat vocabulary across both kinds** rather than a team enum and a business enum:
 * the matrix editor, the effective-permission union and the override UI are then written once, and
 * {@link capabilitiesForKind} decides which subset a given kind actually renders. Named after the
 * consequence, not the screen, so "who may bind us to a seat" reads the same in the matrix as it does
 * in the guard.
 */
export const WorkspaceCapability = z.enum([
	// Membership
	"invite_members",
	"remove_members",
	"manage_roles",
	// Presence & identity
	"edit_profile",
	"manage_settings",
	// Delivery (team)
	"bind_seat",
	"manage_projects",
	"publish_listings",
	// Commerce (business)
	"purchase",
	"hire",
	// Money
	"contribute_funds",
	"spend_funds",
	"withdraw_funds",
	"manage_finances",
	"approve_spend",
	// Oversight
	"view_analytics",
	"view_audit",
	// Terminal
	"archive_entity",
]);
export type WorkspaceCapability = z.infer<typeof WorkspaceCapability>;

/** Capabilities that only make sense on the seller side. */
const TEAM_ONLY: readonly WorkspaceCapability[] = ["bind_seat", "publish_listings"];
/** Capabilities that only make sense on the buyer side. */
const BUSINESS_ONLY: readonly WorkspaceCapability[] = [
	"purchase",
	"hire",
	"contribute_funds",
	"approve_spend",
];

/**
 * The capability columns a given kind renders. A team never shows "approve spend" (it earns, it does
 * not run a purchase-approval ladder); a business never shows "bind seat" (it buys delivery, it does
 * not deliver). Everything else is shared.
 */
export function capabilitiesForKind(kind: WorkspaceKind): WorkspaceCapability[] {
	const excluded = kind === "team" ? BUSINESS_ONLY : TEAM_ONLY;
	return WorkspaceCapability.options.filter((c) => !excluded.includes(c));
}

/**
 * Human labels for the matrix headers and the effective-permission list. Kept beside the enum so a new
 * capability cannot ship without its label (an unlabelled column is an unreadable matrix).
 */
export const CAPABILITY_LABEL: Record<WorkspaceCapability, string> = {
	invite_members: "Invite members",
	remove_members: "Remove members",
	manage_roles: "Change roles",
	edit_profile: "Edit profile",
	manage_settings: "Change settings",
	bind_seat: "Bind to a seat",
	manage_projects: "Manage projects",
	publish_listings: "Publish listings",
	purchase: "Purchase",
	hire: "Hire",
	contribute_funds: "Add funds",
	spend_funds: "Spend funds",
	withdraw_funds: "Withdraw funds",
	manage_finances: "Manage finances",
	approve_spend: "Approve spend",
	view_analytics: "View analytics",
	view_audit: "View audit log",
	archive_entity: "Archive entity",
};

/**
 * The capabilities whose consequences are severe enough that the UI must surface them explicitly
 * rather than bury them in a long list (brief §8 — "surface the consequential permissions honestly").
 */
export const CONSEQUENTIAL: readonly WorkspaceCapability[] = [
	"bind_seat",
	"spend_funds",
	"withdraw_funds",
	"approve_spend",
	"manage_roles",
	"archive_entity",
];
// #endregion

// #region Role presets
/**
 * The capability bundle each preset role carries. Presets are **read-only** in the matrix editor —
 * `Duplicate to custom role` is the escape hatch — so this table is the definition, not a default.
 *
 * `lead` sits between admin and member on the seller side: it may bind the team to a seat and run
 * projects, but may not restructure the roster or move money.
 */
const PRESET_GRANTS: Record<WorkspaceRole, readonly WorkspaceCapability[]> = {
	owner: WorkspaceCapability.options,
	admin: [
		"invite_members",
		"remove_members",
		"manage_roles",
		"edit_profile",
		"manage_settings",
		"bind_seat",
		"manage_projects",
		"publish_listings",
		"purchase",
		"hire",
		"contribute_funds",
		"spend_funds",
		"manage_finances",
		"approve_spend",
		"view_analytics",
		"view_audit",
	],
	lead: [
		"invite_members",
		"bind_seat",
		"manage_projects",
		"publish_listings",
		"purchase",
		"contribute_funds",
		"spend_funds",
		"view_analytics",
	],
	member: ["contribute_funds", "view_analytics"],
};

/** The capabilities a preset role grants, scoped to the kind that actually renders them. */
export function presetCapabilities(
	role: WorkspaceRole,
	kind: WorkspaceKind,
): WorkspaceCapability[] {
	const allowed = new Set(capabilitiesForKind(kind));
	return PRESET_GRANTS[role].filter((c) => allowed.has(c));
}

/** Privilege rank — higher outranks lower. Drives "a member can never grant what they lack" guards. */
export function roleRank(role: WorkspaceRole): number {
	return WorkspaceRole.options.length - WorkspaceRole.options.indexOf(role);
}

/** Human label for a preset role, kind-aware (a business has no `lead`). */
export function roleLabel(role: WorkspaceRole): string {
	switch (role) {
		case "owner":
			return "Owner";
		case "admin":
			return "Admin";
		case "lead":
			return "Lead";
		case "member":
			return "Member";
	}
}

/** The preset roles a kind offers — `lead` is seller-side authority and is hidden on a business. */
export function rolesForKind(kind: WorkspaceKind): WorkspaceRole[] {
	return WorkspaceRole.options.filter((r) => kind === "team" || r !== "lead");
}
// #endregion

// #region Kind-parameterised copy
/**
 * The per-kind vocabulary the shared surface renders. One table, so a screen never branches on kind
 * inline — it looks the noun up. Keeping this beside the capability table means the "the diff between
 * team and business is a capability table, not a duplicated folder" invariant (brief §11) is
 * inspectable in one place.
 */
export interface KindCopy {
	/** Singular noun, sentence case (e.g. "team"). */
	noun: string;
	/** Plural noun, sentence case. */
	plural: string;
	/** Title-case singular for headings. */
	Noun: string;
	/** Title-case plural for headings. */
	Plural: string;
	/** Route base (`/teams` · `/businesses`). */
	base: string;
	/** What the entity is, in one line — the roster empty state sells this. */
	pitch: string;
	/** The verification instrument (KYC for a team's members, KYB for a business). */
	verification: "KYC" | "KYB";
	/** What the shared money pot is called on this side. */
	moneyNoun: string;
}

const COPY: Record<WorkspaceKind, KindCopy> = {
	team: {
		noun: "team",
		plural: "teams",
		Noun: "Team",
		Plural: "Teams",
		base: "/teams",
		pitch: "A team delivers as one unit — shared listings, one reputation, and payouts split " +
			"automatically across the people who did the work.",
		verification: "KYC",
		moneyNoun: "vault",
	},
	business: {
		noun: "business",
		plural: "businesses",
		Noun: "Business",
		Plural: "Businesses",
		base: "/businesses",
		pitch:
			"A business hires as one company — pooled funds several people contribute to and spend " +
			"from, under limits you set.",
		verification: "KYB",
		moneyNoun: "pooled wallet",
	},
};

/** The per-kind noun/route/copy table. */
export function kindCopy(kind: WorkspaceKind): KindCopy {
	return COPY[kind];
}

/** Resolve the entity kind a route base addresses, or `null` if it is not a workspace route. */
export function kindFromPath(pathname: string): WorkspaceKind | null {
	const seg = pathname.split("/").filter(Boolean)[0];
	if (seg === "teams") return "team";
	if (seg === "businesses") return "business";
	return null;
}
// #endregion
