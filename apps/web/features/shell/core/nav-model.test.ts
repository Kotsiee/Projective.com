import { assertEquals } from "@std/assert";
import { GUEST_CONTEXT, PERSONAL_MEMBER_CONTEXT, type UserContext } from "@projective/types/auth";
import { isExploreSurface, isForeignProfilePath } from "./explore-surface.ts";
import { globalNav } from "./nav-model.ts";

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

// #region Teams persona (Decision #228 (A))
const freelancer = { ...PERSONAL_MEMBER_CONTEXT, isClient: false, isFreelancer: true };
const hasTeams = (ctx: UserContext): boolean =>
	globalNav("/home", ctx).some((i) => i.key === "teams");

Deno.test("globalNav — the Teams entry is the freelancer's, not the client's or the operator's", () => {
	assertEquals(hasTeams(freelancer), true);
	assertEquals(hasTeams(PERSONAL_MEMBER_CONTEXT), false);
	assertEquals(hasTeams({ ...freelancer, isClient: true, isOperator: true }), false);
});

Deno.test("globalNav — a member acting as a team keeps Teams; a minor never sees it", () => {
	assertEquals(hasTeams({ ...freelancer, contextType: "team", isOperator: true }), true);
	assertEquals(hasTeams({ ...freelancer, restricted: true }), false);
});
// #endregion

// #region Businesses — real account facts (BUSINESSES_AUDIT BF3, Decision #230 (a))
/** A live session's account facts: no memberships yet, room for a business. */
const fresh = { belongsToTeam: false, belongsToBusiness: false, businessHeadroom: true };
const client: UserContext = { ...PERSONAL_MEMBER_CONTEXT, ...fresh };
const keysOf = (ctx: UserContext): string[] => globalNav("/home", ctx).map((i) => i.key);
const hasBusinesses = (ctx: UserContext): boolean => keysOf(ctx).includes("business");

Deno.test("globalNav — a client adult and a freelancer see Businesses (they may create one)", () => {
	assertEquals(hasBusinesses(client), true);
	assertEquals(hasBusinesses({ ...client, isClient: false, isFreelancer: true }), true);
});

Deno.test("globalNav — a minor never sees Businesses", () => {
	assertEquals(hasBusinesses({ ...client, restricted: true }), false);
	assertEquals(hasBusinesses({ ...client, restricted: true, belongsToBusiness: true }), false);
});

Deno.test("globalNav — an enterprise context sees Businesses only through a membership", () => {
	const enterprise: UserContext = { ...client, contextType: "enterprise", role: "admin" };
	assertEquals(hasBusinesses(enterprise), false);
	assertEquals(hasBusinesses({ ...enterprise, belongsToBusiness: true }), true);
});

Deno.test("globalNav — a business member with no allowance left keeps Businesses", () => {
	assertEquals(
		hasBusinesses({ ...client, belongsToBusiness: true, businessHeadroom: false }),
		true,
	);
	assertEquals(hasBusinesses({ ...client, businessHeadroom: false }), false);
});

Deno.test("globalNav — acting as a business shows Businesses and no seller surface", () => {
	const acting: UserContext = {
		...client,
		contextType: "business",
		handle: "atlaslabs",
		isClient: true,
		isFreelancer: false,
		belongsToBusiness: true,
		businessHeadroom: false,
	};
	const keys = keysOf(acting);
	assertEquals(keys.includes("business"), true);
	assertEquals(keys.includes("catalogue"), false);
	assertEquals(keys.includes("teams"), false);
});
// #endregion
