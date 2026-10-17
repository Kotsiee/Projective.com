import { assertEquals, assertStrictEquals } from "@std/assert";
import {
	businessAuthorityReason,
	businessAuthorityRefusal,
	businessAuthorityRefusalFromMessage,
} from "./business-authority.ts";

Deno.test("a message-only caller still recognises the refusal", () => {
	assertEquals(
		businessAuthorityRefusalFromMessage("ERROR: missing_permission: manage_projects")?.details,
		{
			reason: "manage_projects",
		},
	);
	assertStrictEquals(
		businessAuthorityRefusalFromMessage("Only the project owner may do that."),
		null,
	);
});

Deno.test("each BB2 refusal maps to its reason", () => {
	for (const cap of ["hire", "purchase", "manage_projects"] as const) {
		assertStrictEquals(
			businessAuthorityReason({ code: "PK403", message: `missing_permission: ${cap}` }),
			cap,
		);
	}
	assertStrictEquals(
		businessAuthorityReason({
			code: "PK403",
			message:
				"not_funder: only a member who can spend from the client's wallet can fund this stage",
		}),
		"not_funder",
	);
});

Deno.test("a refusal is a 403 with details.reason", () => {
	const refusal = businessAuthorityRefusal({ code: "PK403", message: "missing_permission: hire" });
	assertEquals(refusal?.status, 403);
	assertEquals(refusal?.details, { reason: "hire" });
	assertStrictEquals(typeof refusal?.message, "string");
});

Deno.test("other PK403s and other codes are not business-authority refusals", () => {
	assertStrictEquals(
		businessAuthorityRefusal({ code: "PK403", message: "payout_not_ready: verify" }),
		null,
	);
	assertStrictEquals(
		businessAuthorityRefusal({ code: "PK403", message: "kyb_required: verify" }),
		null,
	);
	assertStrictEquals(
		businessAuthorityRefusal({ code: "PK403", message: "missing_permission: bind_seat" }),
		null,
	);
	assertStrictEquals(
		businessAuthorityRefusal({ code: "42501", message: "missing_permission: hire" }),
		null,
	);
	assertStrictEquals(businessAuthorityRefusal(null), null);
});
