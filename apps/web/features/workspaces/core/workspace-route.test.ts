import { assertEquals } from "@std/assert";
import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";
import {
	type ConsoleResolutionShape,
	type ConsoleRouteApi,
	importWithoutGlyphs,
	type RegistryApi,
} from "./registry-import.testing.ts";

/**
 * The console's address contract (Decision #228 (B)), pinned at the decision every `/teams*` and
 * `/businesses*` console handler answers through. The registry's glyphs import CSS, so both modules
 * load through {@link importWithoutGlyphs}.
 */
const { consoleResponse, routeConsole } = await importWithoutGlyphs<ConsoleRouteApi>(
	"./console-route.ts",
);
const { firstModuleFor, mayViewModule } = await importWithoutGlyphs<RegistryApi>(
	"./module-registry.tsx",
);

// #region Fixtures
const UUID = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
const HANDLE = "north-loop";
const MEMBER: readonly WorkspaceCapability[] = [];
/** An admin holding the owner's billing grant, so a business's Billing opens for them. */
const ADMIN: readonly WorkspaceCapability[] = [
	"manage_roles",
	"manage_settings",
	"manage_finances",
	"manage_billing",
];

/**
 * A stand-in for `resolveWorkspaceConsole`: the entity resolves (by uuid or any casing of its handle)
 * for a member holding `capabilities`, and the requested module corrects exactly as the SSR bootstrap
 * corrects it. `null` models a missing entity or a non-member — the database answers both alike.
 * Every call is counted in `reads`, so a test can pin that one request costs one read.
 */
let reads = 0;
function resolver(
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[] | null,
): (module: string) => Promise<ConsoleResolutionShape | null> {
	return (module) => {
		reads++;
		if (capabilities === null) return Promise.resolve(null);
		const permitted = mayViewModule(module, kind, capabilities);
		return Promise.resolve({
			workspace: { handle: HANDLE },
			activeModule: permitted ? module : firstModuleFor(kind, capabilities),
			redirectedFrom: permitted ? null : module,
		});
	};
}

/**
 * Route one request and map it to the response its handler would send (`null` = render). A path with
 * no module segment is the console root's own route, which hands `routeConsole` a `null` module.
 */
async function answer(
	kind: WorkspaceKind,
	path: string,
	capabilities: readonly WorkspaceCapability[] | null,
): Promise<{ status: number; location: string | null } | null> {
	const url = new URL(path, "http://localhost");
	const [, , ref, rawModule = null] = url.pathname.split("/");
	reads = 0;
	const route = await routeConsole(
		kind,
		decodeURIComponent(ref),
		rawModule,
		url,
		resolver(kind, capabilities),
	);
	assertEquals(reads, 1, "one console request reads the entity exactly once");
	if (route.kind === "render") return null;
	const res = consoleResponse(route);
	return { status: res.status, location: res.headers.get("location") };
}
// #endregion

// #region Canonical address (308)
Deno.test("console route: a uuid answers 308 to the handle and keeps the query", async () => {
	assertEquals(await answer("team", `/teams/${UUID}/members?view=pending&q=ana`, ADMIN), {
		status: 308,
		location: `/teams/${HANDLE}/members?view=pending&q=ana`,
	});
});

Deno.test("console route: a uuid on the bare console answers 308 to the bare handle", async () => {
	assertEquals(await answer("team", `/teams/${UUID}`, MEMBER), {
		status: 308,
		location: `/teams/${HANDLE}`,
	});
});

Deno.test("console route: an uppercase handle answers 308 to the canonical case", async () => {
	assertEquals(await answer("team", "/teams/North-Loop/projects", MEMBER), {
		status: 308,
		location: `/teams/${HANDLE}/projects`,
	});
});

Deno.test("console route: a business uuid or wrong-case handle answers 308 and keeps the query", async () => {
	assertEquals(await answer("business", `/businesses/${UUID}/billing?view=invoices&q=ana`, ADMIN), {
		status: 308,
		location: `/businesses/${HANDLE}/billing?view=invoices&q=ana`,
	});
	assertEquals(await answer("business", `/businesses/${UUID}`, MEMBER), {
		status: 308,
		location: `/businesses/${HANDLE}`,
	});
	assertEquals(await answer("business", "/businesses/NORTH-LOOP/members", MEMBER), {
		status: 308,
		location: `/businesses/${HANDLE}/members`,
	});
});

Deno.test("console route: the canonical handle renders", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/members?view=pending`, MEMBER), null);
	assertEquals(await answer("business", `/businesses/${HANDLE}`, MEMBER), null);
});
// #endregion

// #region /overview folded into the root (308)
Deno.test("console route: /overview answers 308 to the console root and keeps the query", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/overview?view=week`, MEMBER), {
		status: 308,
		location: `/teams/${HANDLE}?view=week`,
	});
	assertEquals(await answer("business", `/businesses/${HANDLE}/overview?view=week`, MEMBER), {
		status: 308,
		location: `/businesses/${HANDLE}?view=week`,
	});
});

Deno.test("console route: a uuid AND /overview answer ONE 308 to the canonical root", async () => {
	assertEquals(await answer("team", `/teams/${UUID}/overview`, MEMBER), {
		status: 308,
		location: `/teams/${HANDLE}`,
	});
	assertEquals(await answer("business", "/businesses/North-Loop/overview?q=x", MEMBER), {
		status: 308,
		location: `/businesses/${HANDLE}?q=x`,
	});
});

Deno.test("console route: /overview for a non-member answers ONE 303 to the roster", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/overview`, null), {
		status: 303,
		location: "/teams?notice=unavailable",
	});
	assertEquals(await answer("business", `/businesses/${UUID}/overview`, null), {
		status: 303,
		location: "/businesses?notice=unavailable",
	});
});
// #endregion

// #region Withheld module (303)
Deno.test("console route: a module the viewer may not open answers 303 and drops ?view=", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/roles?view=matrix&q=x`, MEMBER), {
		status: 303,
		location: `/teams/${HANDLE}?q=x`,
	});
	assertEquals(await answer("team", `/teams/${HANDLE}/roles?view=matrix`, MEMBER), {
		status: 303,
		location: `/teams/${HANDLE}`,
	});
});

Deno.test("console route: Payouts opens on manage_finances alone; anybody else is 303'd (Teams C4)", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/payouts`, MEMBER), {
		status: 303,
		location: `/teams/${HANDLE}`,
	});
	assertEquals(
		await answer("team", `/teams/${HANDLE}/payouts`, ["spend_funds", "withdraw_funds"]),
		{
			status: 303,
			location: `/teams/${HANDLE}`,
		},
	);
	assertEquals(await answer("team", `/teams/${HANDLE}/payouts`, ["manage_finances"]), null);
});

Deno.test("console route: a uuid AND a withheld module answer ONE 308 to the allowed module", async () => {
	assertEquals(await answer("team", `/teams/${UUID}/roles?view=matrix`, MEMBER), {
		status: 308,
		location: `/teams/${HANDLE}`,
	});
});

Deno.test("console route: a business module the viewer may not open answers 303 and drops ?view=", async () => {
	assertEquals(
		await answer("business", `/businesses/${HANDLE}/billing?view=invoices&q=x`, MEMBER),
		{
			status: 303,
			location: `/businesses/${HANDLE}?q=x`,
		},
	);
	assertEquals(await answer("business", `/businesses/${HANDLE}/settings?view=handle`, MEMBER), {
		status: 303,
		location: `/businesses/${HANDLE}`,
	});
});

Deno.test("console route: a business uuid AND a withheld module answer ONE 308", async () => {
	assertEquals(await answer("business", `/businesses/${UUID}/billing?view=invoices`, MEMBER), {
		status: 308,
		location: `/businesses/${HANDLE}`,
	});
});

Deno.test("console route: a module of the other kind is withheld, not missing", async () => {
	assertEquals(await answer("business", `/businesses/${HANDLE}/payouts`, ADMIN), {
		status: 303,
		location: `/businesses/${HANDLE}`,
	});
});
// #endregion

// #region Unknown module and unavailable entity (303)
Deno.test("console route: an unregistered module answers 303 to the console root", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/vault`, ADMIN), {
		status: 303,
		location: `/teams/${HANDLE}`,
	});
	assertEquals(await answer("business", `/businesses/${HANDLE}/vault?view=x`, ADMIN), {
		status: 303,
		location: `/businesses/${HANDLE}`,
	});
});

Deno.test("console route: an unregistered module under a uuid answers ONE 303 to the canonical root", async () => {
	assertEquals(await answer("team", `/teams/${UUID}/vault`, ADMIN), {
		status: 303,
		location: `/teams/${HANDLE}`,
	});
	assertEquals(await answer("business", "/businesses/North-Loop/vault", MEMBER), {
		status: 303,
		location: `/businesses/${HANDLE}`,
	});
});

Deno.test("console route: an unregistered module for a non-member answers ONE 303 to the roster", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}/vault`, null), {
		status: 303,
		location: "/teams?notice=unavailable",
	});
	assertEquals(await answer("business", `/businesses/${UUID}/vault`, null), {
		status: 303,
		location: "/businesses?notice=unavailable",
	});
});

Deno.test("console route: a non-member answers ONE 303 to the roster with ?notice=unavailable", async () => {
	assertEquals(await answer("team", `/teams/${HANDLE}`, null), {
		status: 303,
		location: "/teams?notice=unavailable",
	});
	assertEquals(await answer("team", `/teams/${UUID}/members?view=pending`, null), {
		status: 303,
		location: "/teams?notice=unavailable",
	});
	assertEquals(await answer("business", `/businesses/${HANDLE}/spend`, null), {
		status: 303,
		location: "/businesses?notice=unavailable",
	});
	assertEquals(await answer("business", `/businesses/${UUID}`, null), {
		status: 303,
		location: "/businesses?notice=unavailable",
	});
});
// #endregion
