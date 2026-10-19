/**
 * The shared route-existence check behind the Create menu's and the BottomNav's "every entry is a
 * page" tests (UI gate 11): it must find a page in any route group at any depth, read a link's path
 * only, and never mistake a `[param]` segment that 404s the address for a page.
 */
import { assert, assertFalse } from "@std/assert";
import { staticRouteServes } from "./route-tree.ts";

Deno.test("staticRouteServes — finds a page in every route group, at any depth", () => {
	assert(staticRouteServes("/"), "(public)/index.tsx");
	assert(staticRouteServes("/home"), "(dashboard)/home.tsx");
	assert(staticRouteServes("/explore"), "(public)/explore.tsx");
	assert(staticRouteServes("/calendar"), "(dashboard)/calendar/index.tsx");
	assert(staticRouteServes("/login"), "(public)/(auth)/login.tsx — a group inside a group");
	assert(staticRouteServes("/teams/create"));
	assert(staticRouteServes("/catalogue"));
});

Deno.test("staticRouteServes — reads the link's path, ignoring its query and fragment", () => {
	assert(staticRouteServes("/projects?create=1"));
	assert(staticRouteServes("/catalogue?create=service#top"));
});

Deno.test("staticRouteServes — a dynamic route that 404s the address is not a page", () => {
	assertFalse(staticRouteServes("/articles/new"), "the editorial reader's [slug]");
	assertFalse(staticRouteServes("/services/new"));
	assertFalse(staticRouteServes("/products/new"));
	assertFalse(staticRouteServes("/create"), "the [handle] profile route would swallow it");
	assertFalse(staticRouteServes("/dashboard"));
	assertFalse(staticRouteServes("/projects/new"), "falls into [projectSlug]");
});
