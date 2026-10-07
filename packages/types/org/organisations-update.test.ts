import { assert, assertEquals } from "@std/assert";
import { UpdateOrganisationSchema } from "./organisations.ts";

Deno.test("UpdateOrganisation — a partial of the editable keys is accepted", () => {
	assert(UpdateOrganisationSchema.safeParse({ tradingName: "Acme" }).success);
	assert(UpdateOrganisationSchema.safeParse({ billingEmail: "", employeeScale: "" }).success);
	assert(
		UpdateOrganisationSchema.safeParse({ defaultCurrency: "gbp", departments: ["Design"] }).success,
	);
});

Deno.test("UpdateOrganisation — platform-owned and unknown keys are refused, like the RPC", () => {
	for (
		const key of ["handle", "status", "verificationLevel", "ownerUserId", "logoFileId", "rating"]
	) {
		assertEquals(UpdateOrganisationSchema.safeParse({ [key]: "x" }).success, false, key);
	}
});

Deno.test("UpdateOrganisation — an empty patch is refused", () => {
	assertEquals(UpdateOrganisationSchema.safeParse({}).success, false);
});

Deno.test("UpdateOrganisation — bounds mirror org.update_organisation", () => {
	assertEquals(UpdateOrganisationSchema.safeParse({ legalName: "  " }).success, false);
	assertEquals(UpdateOrganisationSchema.safeParse({ corporateEmail: "nope" }).success, false);
	assertEquals(UpdateOrganisationSchema.safeParse({ defaultCurrency: "EURO" }).success, false);
	assertEquals(UpdateOrganisationSchema.safeParse({ employeeScale: "huge" }).success, false);
	assertEquals(UpdateOrganisationSchema.safeParse({ tradingName: "x".repeat(161) }).success, false);
});
