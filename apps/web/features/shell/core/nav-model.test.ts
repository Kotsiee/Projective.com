import { assertEquals } from "@std/assert";
import { GUEST_CONTEXT, PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import { isExploreSurface, isForeignProfilePath } from "./explore-surface.ts";

const me = { ...PERSONAL_MEMBER_CONTEXT, handle: "@juno" };

// #region Foreign vs own profile
Deno.test("isForeignProfilePath — somebody else's profile is foreign, the viewer's own is not", () => {
	assertEquals(isForeignProfilePath("/@kenji", me), true);
	assertEquals(isForeignProfilePath("/@kenji/reviews", me), true);
	assertEquals(isForeignProfilePath("/@juno", me), false);
	assertEquals(isForeignProfilePath("/@Juno/posts", me), false);
	assertEquals(isForeignProfilePath("/@juno", { ...me, handle: "juno" }), false);
});

Deno.test("isForeignProfilePath — a context with no handle reads every profile as foreign", () => {
	assertEquals(isForeignProfilePath("/@juno", { handle: null }), true);
});

Deno.test("isForeignProfilePath — a non-profile path is never foreign", () => {
	for (const path of ["/explore", "/view/sv-1", "/projects", "/", "/messages"]) {
		assertEquals(isForeignProfilePath(path, me), false, path);
	}
});
// #endregion

// #region The one predicate both bars read
// `globalNav` and `bottomNavItems` both build glyph VNodes (a CSS import away from a plain test), so
// the predicate they share is pinned here — each lights Explore on exactly `isExploreSurface`.
Deno.test("isExploreSurface — the search, the viewer and a stranger's profile", () => {
	assertEquals(isExploreSurface("/explore", me), true);
	assertEquals(isExploreSurface("/explore/anything", me), true);
	assertEquals(isExploreSurface("/view/sv-brand-identity-sprint", me), true);
	assertEquals(isExploreSurface("/@kenji", me), true);
	assertEquals(isExploreSurface("/@kenji/view/pr-1", me), true);
});

Deno.test("isExploreSurface — dark on the viewer's own profile and off the tree", () => {
	assertEquals(isExploreSurface("/@juno", me), false);
	assertEquals(isExploreSurface("/@juno/reviews", me), false);
	assertEquals(isExploreSurface("/projects", me), false);
	assertEquals(isExploreSurface("/messages", me), false);
});

Deno.test("isExploreSurface — a context with no handle reads every profile as a stranger's", () => {
	// The rail gates a GUEST itself (`isAuthed &&`); the predicate answers for the handle it is given.
	assertEquals(isExploreSurface("/explore", GUEST_CONTEXT), true);
	assertEquals(isExploreSurface("/@kenji", GUEST_CONTEXT), true);
});
// #endregion
