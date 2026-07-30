import { z } from "zod";
import {
	capabilitiesForKind,
	MembershipState,
	presetCapabilities,
	roleRank,
	WorkspaceCapability,
	type WorkspaceKind,
	WorkspaceRole,
} from "./common.ts";

/**
 * workspace/members — the multi-member layer: who belongs, what they may do, and who is waiting on a
 * decision.
 *
 * This is where the genuine design effort of the surface lives (brief §2 — "inherit the surfaces,
 * don't invent them; the genuinely new material is the multi-member layer"), and specifically the
 * **three-layer permission model**:
 *
 *   1. **Preset roles** — read-only named bundles (`owner` · `admin` · `lead` · `member`).
 *   2. **Custom roles** — entity-scoped named bundles an admin composes from any capabilities.
 *   3. **Per-member overrides** — explicit grants and revocations on top of whatever role is held.
 *
 * The effective set is `role ∪ granted − revoked`, computed by {@link effectivePermissions}. It is a
 * **pure function exported from the SSOT** rather than logic living in a component, because the
 * matrix editor, the member drawer, the roster row and the server guard must all agree — three
 * layers computed four different ways is how a permission system starts lying.
 */

// #region Roles (layers 1 & 2)
/**
 * A role definition. A **preset** carries `preset` (and is not editable); a **custom** role carries
 * `preset: null` and an author-chosen capability list. Both appear side by side in every role picker,
 * which is why they share one schema rather than being a union — a picker should not have to know
 * which kind of role it is offering.
 */
export const WorkspaceRoleDefSchema = z.object({
	/** Stable id — a preset's id is its {@link WorkspaceRole} value; a custom role gets a slug. */
	id: z.string().max(64),
	/** Display name ("Admin", "Purchaser", "Finance"). */
	name: z.string().min(1).max(48),
	/** One line explaining the remit — shown under the name in pickers and the matrix. */
	summary: z.string().max(160),
	/** The preset this row IS, or `null` for a custom role. Presets are read-only. */
	preset: WorkspaceRole.nullable(),
	/** The capabilities this role grants. */
	capabilities: z.array(WorkspaceCapability),
	/** How many members currently hold it — the matrix shows this so a role is never deleted blind. */
	memberCount: z.number().int().min(0),
});
export type WorkspaceRoleDef = z.infer<typeof WorkspaceRoleDefSchema>;

/**
 * The tri-state a matrix cell can render. `conditional` is not "half allowed" — it means the
 * capability applies only under a written rule (a spend limit, an approval threshold), and the rule
 * itself is the tooltip. Modelling it explicitly stops a limited permission from being drawn as a
 * plain tick, which would over-promise.
 */
export const CellState = z.enum(["allowed", "conditional", "denied"]);
export type CellState = z.infer<typeof CellState>;
// #endregion

// #region Members (layer 3)
/**
 * A per-member permission override — the third layer. Grants and revocations are kept as two explicit
 * lists rather than a merged effective set so the UI can always show *why* a member differs from their
 * role baseline (`+ Withdraw funds`, `− Invite members`) instead of forcing the reader to diff two
 * capability lists in their head.
 */
export const PermissionOverrideSchema = z.object({
	/** Capabilities granted ON TOP of the role. */
	granted: z.array(WorkspaceCapability).default([]),
	/** Capabilities revoked FROM the role. Revocation wins over a grant from the same role. */
	revoked: z.array(WorkspaceCapability).default([]),
});
export type PermissionOverride = z.infer<typeof PermissionOverrideSchema>;

/** A person in (or pending on) the entity. */
export const WorkspaceMemberSchema = z.object({
	/** Stable id. */
	id: z.string().max(64),
	/** `@handle` without the `@` — profile links resolve to the canonical `/[handle]`. */
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	/** Contact address — shown to admins on the member drawer, used by the invite-by-email path. */
	email: z.string().max(160).nullable(),
	/** The role id they hold ({@link WorkspaceRoleDef.id}) — a preset value or a custom slug. */
	roleId: z.string().max(64),
	/** The preset this role resolves to, for ranking and guard checks. A custom role reports its base. */
	rolePreset: WorkspaceRole,
	state: MembershipState,
	/** Per-member overrides on top of the role. */
	overrides: PermissionOverrideSchema,
	/** ISO date they joined (or were invited). */
	joinedAt: z.string().max(40),
	/** Short job title shown under the name ("Design lead"). */
	title: z.string().max(80).nullable(),
	/** Current commitment, 0–100, driving the workload meter on the roster. */
	workload: z.number().int().min(0).max(100),
	/** Coarse availability signal (mirrors `org.freelancer_profiles.availability_status`). */
	availability: z.enum(["available", "limited", "unavailable"]),
	/** Whether this row is the viewer. */
	isSelf: z.boolean().default(false),
	/**
	 * Per-member spend ceiling in minor units (business only), or `null` for no personal ceiling.
	 * Reuses the semantics of `finance.spending_limits` — never forked (brief §8).
	 */
	spendLimitMinor: z.number().int().min(0).nullable().default(null),
	/** Lifetime contribution to the pooled wallet, minor units (business only). */
	contributedMinor: z.number().int().min(0).default(0),
	/** This member's share of a released payout, in basis points (team only). */
	shareBp: z.number().int().min(0).max(10_000).default(0),
	/** Whether this member's share is currently held back from automatic distribution (team only). */
	shareHeld: z.boolean().default(false),
	/** Who they report to — the org-chart edge. `null` for the root. */
	reportsTo: z.string().max(64).nullable().default(null),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
// #endregion

// #region Invitations & requests
/**
 * A pending invitation (we asked them) or join request (they asked us). One schema, discriminated by
 * {@link direction}, because the inbox renders them in the same list with opposite actions.
 */
export const WorkspaceInviteSchema = z.object({
	id: z.string().max(64),
	direction: z.enum(["invite", "request"]),
	/** Who is being invited / who is asking. */
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
	/** Email invitations may have no handle yet — this carries the address instead. */
	email: z.string().max(160).nullable(),
	/** The role they will hold on acceptance. */
	roleId: z.string().max(64),
	/** Optional note from the sender. */
	note: z.string().max(400).nullable(),
	/** Pre-formatted relative time ("2 days ago") — never a client clock. */
	sentAt: z.string().max(40),
	/** ISO expiry for a share link, or `null` if it does not expire. */
	expiresAt: z.string().max(40).nullable(),
	/** Set when this invite came from a shareable link rather than a direct address. */
	viaLink: z.boolean().default(false),
});
export type WorkspaceInvite = z.infer<typeof WorkspaceInviteSchema>;

/** An invitation the VIEWER has received — the roster index's dismissible strip. */
export const IncomingInviteSchema = z.object({
	id: z.string().max(64),
	workspaceId: z.string().max(64),
	workspaceName: z.string().max(120),
	workspaceHandle: z.string().max(40),
	workspaceAvatar: z.string().max(400),
	kind: z.enum(["team", "business"]),
	/** Who sent it. */
	fromName: z.string().max(120),
	fromHandle: z.string().max(40),
	/** The role offered, already resolved to a label. */
	roleLabel: z.string().max(48),
	sentAt: z.string().max(40),
});
export type IncomingInvite = z.infer<typeof IncomingInviteSchema>;
// #endregion

// #region The effective-permission engine
/**
 * Resolve a member's **effective** capability set: `role ∪ granted − revoked`, intersected with the
 * capabilities the entity kind actually renders.
 *
 * Revocation deliberately wins over the role grant AND over a same-capability grant: an override that
 * both grants and revokes is a contradiction, and denying is the safe reading. Kind-scoping is applied
 * last so a stale override for a capability the kind no longer renders (e.g. `bind_seat` left on a
 * member of an entity that converted) can never leak back as an effective permission.
 */
export function effectivePermissions(
	member: Pick<WorkspaceMember, "rolePreset" | "overrides">,
	kind: WorkspaceKind,
	roles?: readonly WorkspaceRoleDef[],
	roleId?: string,
): WorkspaceCapability[] {
	// Prefer the concrete role definition (so a custom role's own list is honoured); fall back to the
	// preset bundle when the caller has no role table to hand.
	const custom = roles && roleId ? roles.find((r) => r.id === roleId) : undefined;
	const base = custom ? custom.capabilities : presetCapabilities(member.rolePreset, kind);

	const set = new Set<WorkspaceCapability>(base);
	for (const c of member.overrides.granted) set.add(c);
	for (const c of member.overrides.revoked) set.delete(c);

	const allowed = new Set(capabilitiesForKind(kind));
	return WorkspaceCapability.options.filter((c) => set.has(c) && allowed.has(c));
}

/** Whether a member's effective set contains a capability. */
export function can(
	member: Pick<WorkspaceMember, "rolePreset" | "overrides">,
	capability: WorkspaceCapability,
	kind: WorkspaceKind,
	roles?: readonly WorkspaceRoleDef[],
	roleId?: string,
): boolean {
	return effectivePermissions(member, kind, roles, roleId).includes(capability);
}

/**
 * How a single capability reads for a member relative to their role baseline. Returned so a row can be
 * drawn as `+ granted` / `− revoked` / plain, rather than only showing the final answer — the reader
 * should never have to compute the union themselves (brief §8).
 */
export interface PermissionFacet {
	capability: WorkspaceCapability;
	/** Whether the member ends up with it. */
	effective: boolean;
	/** Whether the role baseline grants it. */
	fromRole: boolean;
	/** `grant` / `revoke` when an override moved it away from the baseline, else `null`. */
	override: "grant" | "revoke" | null;
}

/** The full per-capability breakdown for a member — the member drawer's permission list. */
export function permissionFacets(
	member: Pick<WorkspaceMember, "rolePreset" | "overrides">,
	kind: WorkspaceKind,
	roles?: readonly WorkspaceRoleDef[],
	roleId?: string,
): PermissionFacet[] {
	const custom = roles && roleId ? roles.find((r) => r.id === roleId) : undefined;
	const base = new Set(custom ? custom.capabilities : presetCapabilities(member.rolePreset, kind));
	const effective = new Set(effectivePermissions(member, kind, roles, roleId));
	const granted = new Set(member.overrides.granted);
	const revoked = new Set(member.overrides.revoked);

	return capabilitiesForKind(kind).map((capability) => {
		const fromRole = base.has(capability);
		const override: "grant" | "revoke" | null = revoked.has(capability)
			? "revoke"
			: granted.has(capability) && !fromRole
			? "grant"
			: null;
		return { capability, effective: effective.has(capability), fromRole, override };
	});
}

/**
 * Whether `actor` may assign `capability` to somebody else. A member can never grant a permission they
 * do not themselves hold (brief §8) — otherwise the matrix becomes a privilege-escalation ladder.
 */
export function mayGrant(
	actor: Pick<WorkspaceMember, "rolePreset" | "overrides">,
	capability: WorkspaceCapability,
	kind: WorkspaceKind,
): boolean {
	return can(actor, "manage_roles", kind) && can(actor, capability, kind);
}

/**
 * Whether `actor` may change or remove `target`. An actor may never act on somebody who outranks them,
 * and never on themselves for a destructive change (the ownership-transfer path exists for that).
 */
export function mayManageMember(
	actor: Pick<WorkspaceMember, "rolePreset" | "overrides" | "id">,
	target: Pick<WorkspaceMember, "rolePreset" | "id">,
	kind: WorkspaceKind,
): boolean {
	if (actor.id === target.id) return false;
	if (!can(actor, "manage_roles", kind)) return false;
	return roleRank(actor.rolePreset) > roleRank(target.rolePreset);
}

/**
 * Whether removing or demoting `target` would leave the entity ownerless. The last owner cannot be
 * demoted or removed — the UI must route to an ownership transfer instead of refusing blankly
 * (brief §8).
 */
export function isLastOwner(
	target: Pick<WorkspaceMember, "rolePreset" | "id">,
	members: readonly WorkspaceMember[],
): boolean {
	if (target.rolePreset !== "owner") return false;
	return members.filter((m) => m.rolePreset === "owner" && m.state === "active").length <= 1;
}

/** Active members only — the roster count, the ≥2-members proposal gate, and the org chart all use it. */
export function activeMembers(members: readonly WorkspaceMember[]): WorkspaceMember[] {
	return members.filter((m) => m.state === "active");
}
// #endregion
