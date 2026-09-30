import { assert, assertEquals } from "@std/assert";
import {
	incomeSmootherFeeMinor,
	isHandledStripeEvent,
	isHandledStripeThinEvent,
	onboardingReturnPath,
	PayoutAccountScopeSchema,
} from "./payments.ts";

const UUID = "3b1d6e0c-1f2a-4c3b-9d4e-5f6a7b8c9d0e";

Deno.test("the Income Smoother fee is fee_bp of the amount, floored, and never negative", () => {
	assertEquals(incomeSmootherFeeMinor(300_000, 50), 1_500);
	assertEquals(incomeSmootherFeeMinor(199, 50), 0);
	assertEquals(incomeSmootherFeeMinor(-5, 50), 0);
	assertEquals(incomeSmootherFeeMinor(1000, 0), 0);
});

Deno.test("the business payout scope needs its business, the team scope its team", () => {
	assert(PayoutAccountScopeSchema.safeParse({ scope: "business", businessId: UUID }).success);
	assert(!PayoutAccountScopeSchema.safeParse({ scope: "business" }).success);
	assert(!PayoutAccountScopeSchema.safeParse({ scope: "team", businessId: UUID }).success);
});

Deno.test("a business KYB return always lands on the settings page", () => {
	assertEquals(onboardingReturnPath({ scope: "business" }, null), "/settings/verification");
	assertEquals(onboardingReturnPath({ scope: "personal" }, null), "/wallet");
	assertEquals(onboardingReturnPath({ scope: "personal" }, "settings"), "/settings/verification");
});

Deno.test("dispute closure, account updates and saved cards are handled; thin v2 events are separate", () => {
	for (const type of ["charge.dispute.closed", "account.updated", "setup_intent.succeeded"]) {
		assert(isHandledStripeEvent(type), type);
	}
	assert(!isHandledStripeEvent("v2.core.account[configuration.recipient].capability_status_updated"));
	assert(isHandledStripeThinEvent("v2.core.account[configuration.recipient].capability_status_updated"));
});
