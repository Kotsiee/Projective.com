import { assert, assertEquals } from "@std/assert";
import { PERSONAL_MEMBER_CONTEXT, type UserContext } from "@projective/types/auth";
import { parseConsoleUrl } from "@projective/types/catalogue";
import { createMenuOptions, PROJECT_CREATE_HREF } from "./actions-model.ts";
import { staticRouteServes } from "./route-tree.ts";

/** A live session's account facts: no memberships yet, room for a business. */
const fresh = { belongsToTeam: false, belongsToBusiness: false, businessHeadroom: true };
const client: UserContext = { ...PERSONAL_MEMBER_CONTEXT, ...fresh };
const freelancer: UserContext = { ...client, isClient: false, isFreelancer: true };
const keys = (ctx: UserContext): string[] => createMenuOptions(ctx).map((o) => o.key);

// #region Create Team (Decision #228 (A))
Deno.test("createMenuOptions — Create Team is offered to a freelancer", () => {
	assertEquals(keys(freelancer).includes("team"), true);
});

Deno.test("createMenuOptions — Create Team is hidden from a client and from operator mode", () => {
	assertEquals(keys(client).includes("team"), false);
	assertEquals(keys({ ...freelancer, isClient: true, isOperator: true }).includes("team"), false);
});

Deno.test("createMenuOptions — a member acting as a team keeps it; an enterprise and a minor never do", () => {
	assertEquals(
		keys({ ...freelancer, contextType: "team", isOperator: true }).includes("team"),
		true,
	);
	assertEquals(
		keys({ ...PERSONAL_MEMBER_CONTEXT, contextType: "enterprise", isFreelancer: false }).includes(
			"team",
		),
		false,
	);
	// The seller items are query-string deep links into `/catalogue`; the restriction reads the path.
	assertEquals(keys({ ...freelancer, restricted: true }), ["project"]);
});
// #endregion

// #region Create Business — any adult, a buyer surface (Decision #230 (a))
Deno.test("createMenuOptions — a client adult gets Create Business and no seller item", () => {
	assertEquals(keys(client), ["project", "business"]);
});

Deno.test("createMenuOptions — a freelancer and an operator get Create Business too", () => {
	assertEquals(keys(freelancer), ["project", "team", "business", "service", "product"]);
	assertEquals(
		keys({ ...freelancer, isClient: true, isOperator: true }).includes("business"),
		true,
	);
});

Deno.test("createMenuOptions — a minor and an enterprise context never get Create Business", () => {
	assertEquals(keys({ ...client, restricted: true }).includes("business"), false);
	assertEquals(
		keys({ ...client, contextType: "enterprise", role: "admin" }).includes("business"),
		false,
	);
});

Deno.test("createMenuOptions — a business member with no allowance left gets no Create Business", () => {
	const owner = { ...client, belongsToBusiness: true, businessHeadroom: false };
	assertEquals(keys(owner), ["project"]);
});

Deno.test("createMenuOptions — acting as a business offers no seller surface", () => {
	// The hook stamps a business context buyer-only whoever acts in it (Decision #230 (a)).
	const acting: UserContext = {
		...client,
		contextType: "business",
		isClient: true,
		isFreelancer: false,
		belongsToBusiness: true,
	};
	assertEquals(keys(acting), ["project", "business"]);
});

Deno.test("createMenuOptions — a token with no account facts reads the dev:mock fixture", () => {
	assertEquals(keys(PERSONAL_MEMBER_CONTEXT).includes("business"), true);
});
// #endregion

// #region Every option leads to a create flow (Decision #295, gate 11)
Deno.test("createMenuOptions — every option is a page that exists", () => {
	for (const option of createMenuOptions(freelancer)) {
		assert(staticRouteServes(option.href), `${option.key} → ${option.href} has no page`);
	}
});

Deno.test("createMenuOptions — Service and Product open the catalogue console's create flow on their kind", () => {
	const byKey = new Map(createMenuOptions(freelancer).map((o) => [o.key, o.href]));
	for (const kind of ["service", "product"] as const) {
		const state = parseConsoleUrl(new URL(byKey.get(kind) ?? "", "https://projective.test"));
		assertEquals(state.createOpen, true, kind);
		assertEquals(state.createKind, kind);
	}
	assertEquals(byKey.get("project"), PROJECT_CREATE_HREF);
	assertEquals(PROJECT_CREATE_HREF, "/projects?create=1");
});
// #endregion
