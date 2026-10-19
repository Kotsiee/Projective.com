/**
 * The mobile bottom nav's five primaries (DESIGN_SYSTEM.md Part D.3, Decision #296 (B)): every one
 * leads to a route that exists — there is no `/create` or `/dashboard` page, and the `[handle]`
 * profile route used to swallow both as a 404 titled "Profile" — and they light where the reader is.
 */
import { assert, assertEquals } from "@std/assert";
import { BOTTOM_NAV_CREATE_HREF, bottomNavDestinations } from "./bottom-nav-destinations.ts";
import { PROJECT_CREATE_HREF } from "./actions-model.ts";
import { staticRouteServes } from "./route-tree.ts";

Deno.test("bottom nav: exactly five primaries, each to a route that exists", () => {
	const items = bottomNavDestinations("/home");
	assertEquals(items.map((i) => i.label), ["Home", "Explore", "Create", "Workspace", "Calendar"]);
	for (const item of items) assert(staticRouteServes(item.href), `${item.label} → ${item.href}`);
	assertEquals(items.some((i) => i.href === "/create" || i.href === "/dashboard"), false);
});

Deno.test("bottom nav: Create opens the project Quick-Init modal and never lights", () => {
	assertEquals(BOTTOM_NAV_CREATE_HREF, "/projects?create=1");
	assertEquals(BOTTOM_NAV_CREATE_HREF, PROJECT_CREATE_HREF, "the Create menu's first entry");
	const create = (path: string) => bottomNavDestinations(path).find((i) => i.key === "create");
	assertEquals(create("/home")?.href, BOTTOM_NAV_CREATE_HREF);
	assertEquals(create("/projects")?.active, false);
});

Deno.test("bottom nav: each primary lights on its own surface only", () => {
	const lit = (path: string) =>
		bottomNavDestinations(path, { handle: "juno" }).filter((i) => i.active).map((i) => i.key);
	assertEquals(lit("/home"), ["home"]);
	assertEquals(lit("/explore"), ["explore"]);
	assertEquals(lit("/@kenji"), ["explore"]);
	assertEquals(lit("/@juno"), []);
	assertEquals(lit("/projects/prj-abc/overview"), ["workspace"]);
	assertEquals(lit("/services"), ["workspace"]);
	assertEquals(lit("/calendar"), ["calendar"]);
	assertEquals(lit("/wallet"), []);
});
