import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";

/**
 * role-templates — the custom-role TEMPLATES the role editor offers as starting points (Decision
 * #250 (a) + (f); the same shape #230 (b) chose for a business's Project Manager / Observer).
 *
 * A template is not a role and not a preset. Picking one fills the editor — a suggested name, the
 * rank it is based on and a capability list — and pressing Create writes an ordinary CUSTOM role
 * through `org.upsert_workspace_role`, so the preset vocabulary stays owner · admin · lead · member
 * and nothing here reaches SQL, the enum or the vault projection. The list is DATA: a further
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
 * withholds. So the row carries `view_analytics` alone. A business's Project Manager and Observer
 * rows belong to the Businesses series (BU7).
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
