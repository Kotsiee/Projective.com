import { assertEquals } from "@std/assert";
import { businessNotActiveRefusal } from "./business-lifecycle.ts";

const BUSINESS = "5f0c7c1e-3a1b-4c2d-9e8f-0a1b2c3d4e5f";

Deno.test("an archived business's money-in refusal is a 409 the refusal map words, with its status and id", () => {
	assertEquals(
		businessNotActiveRefusal({
			code: "55000",
			message: "business_not_active: this business is archived — restore it first",
			details: JSON.stringify({ business_id: BUSINESS.toUpperCase(), status: "archived" }),
		}),
		{
			status: 409,
			message: "This business is archived — restore it first.",
			details: { reason: "business_not_active", status: "archived", businessId: BUSINESS },
		},
	);
});

Deno.test("a draft's refusal names its status; a missing or unknown status or id is left out", () => {
	assertEquals(
		businessNotActiveRefusal({
			code: "55000",
			message: "business_not_active: publish the business first",
			details: JSON.stringify({ business_id: BUSINESS, status: "draft" }),
		})?.details,
		{ reason: "business_not_active", status: "draft", businessId: BUSINESS },
	);
	assertEquals(
		businessNotActiveRefusal({
			code: "55000",
			message: "ERROR:  business_not_active: publish the business first.",
			details: null,
		}),
		{
			status: 409,
			message: "Publish the business first.",
			details: { reason: "business_not_active" },
		},
	);
	assertEquals(
		businessNotActiveRefusal({
			code: "55000",
			message: "business_not_active: publish the business first",
			details: "{not json",
		})?.details,
		{ reason: "business_not_active" },
	);
	assertEquals(
		businessNotActiveRefusal({
			code: "55000",
			message: "business_not_active: publish the business first",
			details: JSON.stringify({ business_id: "not-a-uuid", status: "deleted" }),
		})?.details,
		{ reason: "business_not_active" },
	);
});

Deno.test("only a 55000 with the business_not_active prefix is one", () => {
	assertEquals(
		businessNotActiveRefusal({
			code: "55000",
			message: "plan: you already own as many as your plan includes",
		}),
		null,
	);
	assertEquals(
		businessNotActiveRefusal({
			code: "22023",
			message: "business_not_active: publish the business first",
		}),
		null,
	);
	assertEquals(
		businessNotActiveRefusal({ code: "55000", message: "wallet_balance: empty the wallet" }),
		null,
	);
	assertEquals(businessNotActiveRefusal(null), null);
});
