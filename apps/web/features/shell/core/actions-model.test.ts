import { assertEquals } from "@std/assert";
import { PERSONAL_MEMBER_CONTEXT, type UserContext } from "@projective/types/auth";
import { createMenuOptions } from "./actions-model.ts";

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
	assertEquals(keys({ ...freelancer, restricted: true }), ["project", "article"]);
});
// #endregion

// #region Create Business — any adult, a buyer surface (Decision #230 (a))
Deno.test("createMenuOptions — a client adult gets Create Business and no seller item", () => {
	assertEquals(keys(client), ["project", "business", "article"]);
});

Deno.test("createMenuOptions — a freelancer and an operator get Create Business too", () => {
	assertEquals(keys(freelancer), ["project", "team", "business", "service", "product", "article"]);
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
	assertEquals(keys(owner), ["project", "article"]);
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
	assertEquals(keys(acting), ["project", "business", "article"]);
});

Deno.test("createMenuOptions — a token with no account facts reads the dev:mock fixture", () => {
	assertEquals(keys(PERSONAL_MEMBER_CONTEXT).includes("business"), true);
});
// #endregion
