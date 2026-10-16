import { assert, assertEquals } from "@std/assert";
import { UpdateEnterpriseSchema } from "./enterprises.ts";

Deno.test("UpdateEnterprise — a partial of the editable keys is accepted", () => {
	assert(UpdateEnterpriseSchema.safeParse({ tradingName: "Acme" }).success);
	assert(UpdateEnterpriseSchema.safeParse({ billingEmail: "", employeeScale: "" }).success);
	assert(
		UpdateEnterpriseSchema.safeParse({ defaultCurrency: "gbp", departments: ["Design"] }).success,
	);
});

Deno.test("UpdateEnterprise — platform-owned and unknown keys are refused, like the RPC", () => {
	for (
		const key of ["handle", "status", "verificationLevel", "ownerUserId", "logoFileId", "rating"]
	) {
		assertEquals(UpdateEnterpriseSchema.safeParse({ [key]: "x" }).success, false, key);
	}
});

Deno.test("UpdateEnterprise — an empty patch is refused", () => {
	assertEquals(UpdateEnterpriseSchema.safeParse({}).success, false);
});

Deno.test("UpdateEnterprise — bounds mirror org.update_enterprise", () => {
	assertEquals(UpdateEnterpriseSchema.safeParse({ legalName: "  " }).success, false);
	assertEquals(UpdateEnterpriseSchema.safeParse({ corporateEmail: "nope" }).success, false);
	assertEquals(UpdateEnterpriseSchema.safeParse({ defaultCurrency: "EURO" }).success, false);
	assertEquals(UpdateEnterpriseSchema.safeParse({ employeeScale: "huge" }).success, false);
	assertEquals(UpdateEnterpriseSchema.safeParse({ tradingName: "x".repeat(161) }).success, false);
});
