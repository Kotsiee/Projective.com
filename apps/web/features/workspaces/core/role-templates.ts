import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";

/**
 * role-templates — the custom-role TEMPLATES the role editor offers as starting points (Decision
 * #250 (a) + (f); the same shape #230 (b) chose for a business's Project Manager / Observer).
 *
 * A template is not a role and not a preset. Picking one fills the editor — a suggested name, the
 * rank it is based on and a capability list — and pressing Create writes an ordinary CUSTOM role
 * through `org.upsert_workspace_role`, so the preset vocabulary stays the kind's own (a team's four, a
 * business's owner · admin · member) and nothing here reaches SQL, the enum or the vault projection.
 * The list is DATA: a further
 * template is one more row below, with no code to change. `core/roles-model.ts` scopes it to a kind
 * and filters every row's capabilities down to what the author may grant before it is offered.
 *
 * Pure: no preact, no CSS, no network.
 */

// #region Shape
/** One custom-role template. */
export interface RoleTemplate {
	/** Stable key — the editor's option value is `template:<key>`. */
	key: string;
	/** The role name the template suggests (the author may change it). */
	name: string;
	/** The role's one-line remit, written to the role's `summary`. */
	summary: string;
	/** The preset the new role ranks as — never `owner` (ownership moves only by transfer). */
	basePreset: "admin" | "lead" | "member";
	/** The capabilities it starts with, before the author's own grant filter. */
	capabilities: readonly WorkspaceCapability[];
	/** The entity kinds that offer it. */
	kinds: readonly WorkspaceKind[];
}
// #endregion

// #region The rows
/**
 * Every template, in the order the editor lists them.
 *
 * **Contributor** (Decision #250 (a), (f)): based on Member, with `view_analytics` and read access to
 * the team's projects. Capabilities are binary, so the work order's "`manage_projects` read-only" is
 * mapped to the nearest real grant — which is NONE: reading a team's projects is every member's
 * already (the Projects module is open to every active member, and only `manage_projects` changes
 * anything), and granting `manage_projects` would hand over exactly the write access "read-only"
 * withholds. So the row carries `view_analytics` alone.
 *
 * **Project Manager** (a business's, Decision #230 (b) [1]; BU7, Decision #249 (a)): PRODUCT_SPEC's
 * remit and no more — it "creates Projects/Pipelines, approves submissions and releases Escrow
 * payments". Based on Member, with `manage_projects` (create a project billed to the business),
 * `hire` (hire, and approve the work that releases escrow), `spend_funds` + `purchase` (fund escrow
 * and buy from the pool, within the envelope the spend policy sets) and the Member preset's
 * `contribute_funds` + `view_analytics`. No people, role, settings or audit rights, and nothing that
 * runs the wallet's policy (`manage_finances`, `approve_spend`); the owner-reserved rights are never a
 * role's (#238). Member rank keeps it governable: an Admin sets its holders' spending limits and
 * manages them (`editable_member_ids` and the member rank rule need the editor to outrank the seat).
 * `manage_projects` makes its holder a MANAGER, so it takes one of the plan's `business_managers`
 * seats (`fn_business_role_is_manager`). The work order's "base admin minus withdraw/finance" was
 * read under the spec's narrower remit, and the owner ruled it stays that way (2026-10-19, #249 (a):
 * kept as built).
 *
 * **Observer** (a business's, #230 (b) [1]; #249 (b)): based on Member, with `view_analytics` alone —
 * every member already sees the business's projects, so it reads progress and analytics and changes,
 * approves and pays for nothing; it drops the Member preset's `contribute_funds`.
 *
 * `supabase/probes/business_members_roles.sql` writes both lists through `org.upsert_workspace_role`
 * as an owner and an admin, and keeps a copy of each (`template:`) that must stay in step with this.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
	{
		key: "contributor",
		name: "Contributor",
		summary: "Delivers on the team's projects and reads its analytics; changes nothing else.",
		basePreset: "member",
		capabilities: ["view_analytics"],
		kinds: ["team"],
	},
	{
		key: "project_manager",
		name: "Project Manager",
		summary:
			"Creates and runs projects, hires and approves the work, and spends from the wallet on it within their limit. Manages no members, roles or policy.",
		basePreset: "member",
		capabilities: [
			"manage_projects",
			"purchase",
			"hire",
			"contribute_funds",
			"spend_funds",
			"view_analytics",
		],
		kinds: ["business"],
	},
	{
		key: "observer",
		name: "Observer",
		summary:
			"Follows the projects and reads the analytics; approves, pays for and changes nothing.",
		basePreset: "member",
		capabilities: ["view_analytics"],
		kinds: ["business"],
	},
];
// #endregion

// #region Scoping
/** The templates an entity kind offers, in list order. */
export function templatesForKind(
	kind: WorkspaceKind,
	templates: readonly RoleTemplate[] = ROLE_TEMPLATES,
): RoleTemplate[] {
	return templates.filter((t) => t.kinds.includes(kind));
}
// #endregion
