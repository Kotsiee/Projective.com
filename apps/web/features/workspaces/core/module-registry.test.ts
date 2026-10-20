import { assert, assertEquals } from "@std/assert";
import type { WorkspaceCapability } from "@projective/types/workspace";
import { importWithoutGlyphs, type RegistryApi } from "./registry-import.testing.ts";

/**
 * The console's hubs (Decision #306, superseding #228 (C) and #232's primary views), pinned at the
 * registry the lane, the rail and the header band all read. The registry's glyphs import CSS, so it
 * loads through {@link importWithoutGlyphs}.
 */
const { hubOf, hubsForViewer, modulesForViewer, MODULES, NAV_HUBS } = await importWithoutGlyphs<
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
	"manage_billing",
	"view_analytics",
	"view_audit",
	"archive_entity",
];
/** Everything but `manage_roles`. */
const NO_ROLES = OWNER.filter((c) => c !== "manage_roles");

const keys = (modules: readonly { key: string }[]): string[] => modules.map((m) => m.key);
const hubKeys = (kind: "team" | "business", caps: readonly WorkspaceCapability[]) =>
	hubsForViewer(kind, caps).map((h) => h.hub.key);
// #endregion

Deno.test("registry: every module but channels sits in exactly one hub", () => {
	const listed = NAV_HUBS.flatMap((h) => h.modules);
	assertEquals(new Set(listed).size, listed.length, "a module sits in two hubs");
	assertEquals(
		listed.toSorted(),
		keys(MODULES).filter((k) => k !== "channels").toSorted(),
	);
	assertEquals(hubOf("channels"), null);
	assertEquals(hubOf("roles")?.key, "roster");
	assertEquals(hubOf(null), null);
});

Deno.test("registry: a team owner's hubs, in lane order", () => {
	assertEquals(hubKeys("team", OWNER), [
		"overview",
		"projects",
		"calendar",
		"files",
		"catalogue",
		"roster",
		"vault",
		"insights",
		"settings",
	]);
	const vault = hubsForViewer("team", OWNER).find((h) => h.hub.key === "vault");
	assertEquals(keys(vault?.modules ?? []), ["finance", "payouts"]);
	assertEquals(vault?.label, "Vault & finances");
});

Deno.test("registry: a business owner's hubs, in lane order", () => {
	assertEquals(hubKeys("business", OWNER), [
		"overview",
		"projects",
		"calendar",
		"files",
		"talent",
		"roster",
		"vault",
		"insights",
		"settings",
	]);
	const vault = hubsForViewer("business", OWNER).find((h) => h.hub.key === "vault");
	assertEquals(keys(vault?.modules ?? []), ["finance", "spend", "billing"]);
	assertEquals(vault?.label, "Wallet & spending");
});

Deno.test("registry: a hub lists only the modules the viewer may open", () => {
	const roster = hubsForViewer("team", NO_ROLES).find((h) => h.hub.key === "roster");
	assertEquals(keys(roster?.modules ?? []), ["members", "invitations"]);
	for (const kind of ["team", "business"] as const) {
		for (const caps of [OWNER, NO_ROLES, []]) {
			const inHubs = hubsForViewer(kind, caps).flatMap((h) => keys(h.modules));
			assertEquals(
				[...inHubs, "channels"].toSorted(),
				keys(modulesForViewer(kind, caps)).toSorted(),
			);
			for (const hub of hubsForViewer(kind, caps)) assert(hub.modules.length > 0);
		}
	}
});

Deno.test("registry: a capability-less member keeps the permissionless hubs", () => {
	for (const kind of ["team", "business"] as const) {
		assertEquals(hubKeys(kind, []), [
			"overview",
			"projects",
			"calendar",
			"files",
			"roster",
			"insights",
		]);
	}
	assertEquals(keys(modulesForViewer("team", [])).includes("channels"), true);
	assertEquals(keys(modulesForViewer("team", [])).includes("messages"), false);
});
