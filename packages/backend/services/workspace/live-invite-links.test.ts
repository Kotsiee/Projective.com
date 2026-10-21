import { assert, assertEquals } from "@std/assert";
import { InviteMembersInputSchema, isOrgInviteLinkToken } from "@projective/types/workspace";
import { redeemRefusal, refusalCode, refusedState } from "./live-invite-links.ts";
import { toInviteLink, toJoinRequest } from "./mappers.ts";

Deno.test("invite links: a redeem refusal keeps the state's status and names it", () => {
	const dup = redeemRefusal({
		code: "23505",
		message: "You have already asked to join this team.",
		details: "state=requested",
	});
	assertEquals(dup.status, 409);
	assertEquals(dup.details, { reason: "requested" });
	const off = redeemRefusal({
		code: "23514",
		message: "This invite link has been turned off.",
		details: "state=revoked",
	});
	assertEquals(off.status, 422);
	assertEquals(off.message, "This invite link has been turned off.");
	const persona = redeemRefusal({ code: "23514", message: "Teams are…", details: "state=persona" });
	assertEquals([persona.status, persona.details?.reason], [422, "persona"]);
	// An unknown token is the generic mapping's 404.
	assertEquals(
		redeemRefusal({ code: "P0002", message: "This invite link doesn't work." }).status,
		404,
	);
	assertEquals(refusedState("state=nonsense"), null);
});

Deno.test("invite batch: a refused recipient's code follows its status", () => {
	assertEquals(
		[409, 402, 403, 404, 422, 429, 503].map(refusalCode),
		["duplicate", "plan", "forbidden", "not_found", "invalid", "rate_limited", "unavailable"],
	);
});

Deno.test("invite batch: the schema reads types, lowercases, and drops a repeated address", () => {
	const parsed = InviteMembersInputSchema.parse({
		kind: "team",
		workspaceId: "a4c25501-0fdd-4abe-a575-ff478daad4fc",
		recipients: [
			{ type: "handle", value: "Ravi", roleId: "r1" },
			{ type: "email", value: "Ana@Company.com", roleId: "r2" },
			{ type: "handle", value: "ravi", roleId: "r3" },
		],
	});
	assertEquals(parsed.recipients.map((r) => [r.type, r.value, r.roleId]), [
		["handle", "ravi", "r1"],
		["email", "ana@company.com", "r2"],
	]);
	assert(
		!InviteMembersInputSchema.safeParse({
			kind: "team",
			workspaceId: "x",
			recipients: [{ type: "email", value: "not-an-email", roleId: "r" }],
		}).success,
	);
});

Deno.test("invite links: the detail's link and requests map onto the SSOT", () => {
	const link = toInviteLink({
		id: "l1",
		token: "w-x0t3QifZHb9CY-oAp0CpfVpt",
		role_id: "role-1",
		created_at: "2026-10-21T21:54:33.125063+00:00",
	});
	assertEquals(link?.path, "/invite/w-x0t3QifZHb9CY-oAp0CpfVpt");
	assert(link && isOrgInviteLinkToken(link.token));
	assertEquals(toInviteLink(null), null);

	const now = Date.parse("2026-10-21T22:00:00Z");
	const request = toJoinRequest(
		{
			id: "q1",
			requester_user_id: "u1",
			role_id: "role-1",
			message: "  Keen to help  ",
			via_link: true,
			created_at: "2026-10-21T21:00:00Z",
		},
		{ username: "lenamueller", name: "Lena Müller", avatar: null },
		now,
	);
	assertEquals(
		[request.handle, request.name, request.message, request.viaLink, request.roleId],
		["lenamueller", "Lena Müller", "Keen to help", true, "role-1"],
	);
	const nobody = toJoinRequest(
		{
			id: "q2",
			requester_user_id: "u2",
			role_id: "r",
			message: null,
			via_link: false,
			created_at: "",
		},
		undefined,
		now,
	);
	assertEquals([nobody.name, nobody.message, nobody.viaLink], ["Someone", null, false]);
});
