import { assertEquals } from "@std/assert";
import { PERSONAL_MEMBER_CONTEXT, type UserContext } from "@projective/types/auth";
import { createMenuOptions } from "./actions-model.ts";

const freelancer: UserContext = { ...PERSONAL_MEMBER_CONTEXT, isClient: false, isFreelancer: true };
const keys = (ctx: UserContext): string[] => createMenuOptions(ctx).map((o) => o.key);

// #region Create Team (Decision #228 (A))
Deno.test("createMenuOptions — Create Team is offered to a freelancer", () => {
	assertEquals(keys(freelancer).includes("team"), true);
});

Deno.test("createMenuOptions — Create Team is hidden from a client and from operator mode", () => {
	assertEquals(keys(PERSONAL_MEMBER_CONTEXT).includes("team"), false);
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

Deno.test("createMenuOptions — a client keeps Project and Article only", () => {
	assertEquals(keys(PERSONAL_MEMBER_CONTEXT), ["project", "article"]);
});
// #endregion
