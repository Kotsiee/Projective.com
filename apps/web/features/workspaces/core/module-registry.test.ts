import { assertEquals } from "@std/assert";
import type { WorkspaceCapability } from "@projective/types/workspace";
import { importWithoutGlyphs, type RegistryApi } from "./registry-import.testing.ts";

/**
 * The console's primary views (Decision #228 (C)), pinned at the registry the lane (L1) and the header
 * band (L2) both read. The registry's glyphs import CSS, so it loads through {@link importWithoutGlyphs}.
 */
const { modulesForViewer, primaryModules, secondaryModules } = await importWithoutGlyphs<
	RegistryApi
>("./module-registry.tsx");

// #region Fixtures
/** Every capability — the owner's effective set. */
const OWNER: readonly WorkspaceCapability[] = [
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
	"withdraw_funds",
	"manage_finances",
	"approve_spend",
	"view_analytics",
	"view_audit",
	"archive_entity",
];
/** Everything but `manage_roles`. */
const NO_ROLES = OWNER.filter((c) => c !== "manage_roles");

const keys = (modules: { key: string }[]): string[] => modules.map((m) => m.key);
// #endregion

Deno.test("registry: a team's primary views are (C)'s six, in (C)'s order", () => {
	assertEquals(keys(primaryModules("team", OWNER)), [
		"overview",
		"members",
		"projects",
		"payouts",
		"roles",
		"settings",
	]);
});

Deno.test("registry: a team's secondary group is every other module, in registry order", () => {
	assertEquals(keys(secondaryModules("team", OWNER)), [
		"catalogue",
		"calendar",
		"messages",
		"invitations",
		"finance",
		"analytics",
		"standing",
		"profile",
		"verification",
	]);
});

Deno.test("registry: a member without manage_roles gets five primaries and no Roles anywhere", () => {
	assertEquals(keys(primaryModules("team", NO_ROLES)), [
		"overview",
		"members",
		"projects",
		"payouts",
		"settings",
	]);
	assertEquals(keys(secondaryModules("team", NO_ROLES)).includes("roles"), false);
});

Deno.test("registry: primary and secondary partition the viewer's visible set", () => {
	for (const kind of ["team", "business"] as const) {
		for (const caps of [OWNER, NO_ROLES, []]) {
			const split = [...keys(primaryModules(kind, caps)), ...keys(secondaryModules(kind, caps))];
			assertEquals(split.toSorted(), keys(modulesForViewer(kind, caps)).toSorted());
		}
	}
});

Deno.test("registry: a capability-less member keeps the permissionless primaries", () => {
	assertEquals(keys(primaryModules("team", [])), ["overview", "members", "projects"]);
	assertEquals(keys(primaryModules("business", [])), ["overview", "members", "projects"]);
});

Deno.test("registry: a business's primary views are Decision #232's six, in order", () => {
	assertEquals(keys(primaryModules("business", OWNER)), [
		"overview",
		"members",
		"projects",
		"spend",
		"billing",
		"settings",
	]);
	assertEquals(keys(secondaryModules("business", OWNER)).includes("finance"), true);
});
