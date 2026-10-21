import { assertEquals } from "@std/assert";
import {
	presetCapabilities,
	type WorkspaceCapability,
	type WorkspaceKind,
} from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import {
	importWithoutGlyphs,
	type RegistryApi,
} from "@features/workspaces/core/registry-import.testing.ts";
import { mayManageTeamCatalogue } from "@features/workspaces/core/catalogue-gate.ts";
import {
	apiSellerActor,
	routeSellerScope,
	teamCatalogueRoute,
	teamSellerActor,
} from "./seller-scope.ts";

/**
 * seller-scope (Decision #312) — the team catalogue opens to exactly the members the team console's
 * registry offers its Catalogue to, and its redirects are the console's own, one hop each. The
 * registry's glyphs import CSS, so it loads through {@link importWithoutGlyphs}.
 */
const { mayViewModule } = await importWithoutGlyphs<RegistryApi>(
	"../../workspaces/core/module-registry.tsx",
);

// #region Fixtures
const ACTOR: ReadActor = {
	userId: "u-1",
	contextId: "",
	contextType: "personal",
	accessToken: "t",
};
const LEAD = presetCapabilities("lead", "team");
const MEMBER = presetCapabilities("member", "team");
const team = (handle: string, viewerCapabilities: readonly WorkspaceCapability[]) => ({
	id: "team-1",
	kind: "team" as const,
	handle,
	viewerCapabilities: [...viewerCapabilities],
});
const at = (path: string) => new URL(`https://app.example.test${path}`);
// #endregion

Deno.test("the catalogue gate is the registry's own, for every preset and kind", () => {
	const kinds: WorkspaceKind[] = ["team", "business"];
	for (const kind of kinds) {
		for (const preset of ["owner", "admin", "lead", "member"] as const) {
			const caps = presetCapabilities(preset, kind);
			assertEquals(
				mayManageTeamCatalogue({ kind, viewerCapabilities: caps }),
				mayViewModule("catalogue", kind, caps),
				`${kind} ${preset}`,
			);
		}
		for (const caps of [[], ["publish_listings"]] as WorkspaceCapability[][]) {
			assertEquals(
				mayManageTeamCatalogue({ kind, viewerCapabilities: caps }),
				mayViewModule("catalogue", kind, caps),
				`${kind} ${caps.join(",")}`,
			);
		}
	}
});

Deno.test("a member who may open the Catalogue acts as the team; anyone else does not", () => {
	assertEquals(teamSellerActor(team("north-loop", LEAD), ACTOR), {
		...ACTOR,
		contextType: "team",
		contextId: "team-1",
	});
	assertEquals(teamSellerActor(team("north-loop", MEMBER), ACTOR), null);
});

Deno.test("a team catalogue page renders at its canonical address only", () => {
	const url = at("/teams/north-loop/catalogue/svc-23456789ab?tab=preview");
	assertEquals(teamCatalogueRoute("north-loop", team("north-loop", LEAD), url), { kind: "render" });
});

Deno.test("a non-canonical handle is one 308, keeping the path below the root and the query", () => {
	const url = at("/teams/North-Loop/catalogue/svc-23456789ab/simulate?device=mobile");
	assertEquals(teamCatalogueRoute("North-Loop", team("north-loop", LEAD), url), {
		kind: "redirect",
		status: 308,
		location: "/teams/north-loop/catalogue/svc-23456789ab/simulate?device=mobile",
	});
	assertEquals(
		teamCatalogueRoute("North-Loop", team("north-loop", LEAD), at("/teams/North-Loop/catalogue")),
		{ kind: "redirect", status: 308, location: "/teams/north-loop/catalogue" },
	);
});

Deno.test("a viewer without the gate goes to the console root; a non-member to the roster", () => {
	const url = at("/teams/north-loop/catalogue?status=draft");
	assertEquals(teamCatalogueRoute("north-loop", team("north-loop", MEMBER), url), {
		kind: "redirect",
		status: 303,
		location: "/teams/north-loop",
	});
	assertEquals(teamCatalogueRoute("NORTH-LOOP", team("north-loop", MEMBER), url), {
		kind: "redirect",
		status: 308,
		location: "/teams/north-loop",
	});
	assertEquals(teamCatalogueRoute("north-loop", null, url), {
		kind: "redirect",
		status: 303,
		location: "/teams?notice=unavailable",
	});
});

Deno.test("off a team route the scope is the acting seller, and nothing is read", async () => {
	assertEquals(await routeSellerScope(undefined, at("/catalogue"), ACTOR), {
		actor: ACTOR,
		team: null,
	});
});

Deno.test("an API call without ?team= keeps the session's actor", async () => {
	assertEquals(await apiSellerActor(at("/api/catalogue/list?type=all"), ACTOR), ACTOR);
});

Deno.test("an API ?team= refuses a guest with 401 and a malformed handle with 404, unread", async () => {
	const guest = await apiSellerActor(at("/api/catalogue/list?team=north-loop"), {
		userId: "",
		contextId: "",
		contextType: "personal",
	});
	assertEquals(guest instanceof Response ? guest.status : null, 401);
	const bad = await apiSellerActor(at("/api/catalogue/list?team=North%20Loop"), ACTOR);
	assertEquals(bad instanceof Response ? bad.status : null, 404);
});
