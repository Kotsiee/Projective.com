import { assertEquals } from "@std/assert";
import { kybCopy, kycCopy, payoutCopy, returnNotice } from "./verification-model.ts";

Deno.test("an identity check in review offers no step — there is nothing to do but wait", () => {
	assertEquals(kycCopy("pending").action, null);
	assertEquals(kycCopy("unverified").action, "Verify your identity");
	assertEquals(kycCopy("verified").action, null);
});

Deno.test("only a member who manages billing is offered a business's KYB step", () => {
	assertEquals(kybCopy("unverified", true).action, "Verify business");
	assertEquals(kybCopy("unverified", false).action, null);
	assertEquals(kybCopy("verified", true).action, null);
});

Deno.test("a disabled payout account offers no step; a missing one offers setup", () => {
	assertEquals(payoutCopy(null).action, "Set up payouts");
	assertEquals(
		payoutCopy({
			ownerType: "freelancer",
			ownerId: "3b1d6e0c-1f2a-4c3b-9d4e-5f6a7b8c9d0e",
			accountId: "acct_1",
			status: "disabled",
			transfersCapability: "unsupported",
			payoutReady: false,
		}).action,
		null,
	);
});

Deno.test("a return from Stripe's hosted flow is announced", () => {
	assertEquals(returnNotice(new URLSearchParams("identity=returned"))?.tone, "info");
	assertEquals(returnNotice(new URLSearchParams("kyb=verified"))?.tone, "success");
	assertEquals(returnNotice(new URLSearchParams("")), null);
});
