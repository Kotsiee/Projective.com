import { assertEquals } from "@std/assert";
import type { ConnectAccountStatus, VerificationStatus } from "@projective/types/finance";
import {
	kybCopy,
	kycCopy,
	nextVerificationStep,
	payoutCopy,
	returnNotice,
	verificationStamps,
} from "./verification-model.ts";

function account(status: ConnectAccountStatus["status"]): ConnectAccountStatus {
	return {
		ownerType: "freelancer",
		ownerId: "3b1d6e0c-1f2a-4c3b-9d4e-5f6a7b8c9d0e",
		accountId: status === "not_started" ? null : "acct_1",
		status,
		transfersCapability: null,
		payoutReady: status === "verified",
	};
}

function picture(overrides: Partial<VerificationStatus>): VerificationStatus {
	return {
		isFreelancer: true,
		kycStatus: "unverified",
		kycTier: null,
		payoutReady: false,
		latestCase: null,
		payoutAccount: null,
		businesses: [],
		processorConnected: true,
		...overrides,
	};
}

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

Deno.test("one filled step: identity before payouts, nothing while the processor is offline", () => {
	assertEquals(nextVerificationStep(picture({})), "kyc");
	assertEquals(nextVerificationStep(picture({ kycStatus: "pending" })), "payouts");
	assertEquals(
		nextVerificationStep(picture({ kycStatus: "verified", payoutAccount: account("restricted") })),
		"payouts",
	);
	assertEquals(
		nextVerificationStep(picture({ kycStatus: "verified", payoutAccount: account("verified") })),
		null,
	);
	assertEquals(
		nextVerificationStep(picture({ kycStatus: "verified", payoutAccount: account("disabled") })),
		null,
	);
	assertEquals(nextVerificationStep(picture({ isFreelancer: false })), "payouts");
	assertEquals(nextVerificationStep(picture({ processorConnected: false })), null);
});

Deno.test("the payout crest needs a verified identity AND a verified payout account", () => {
	assertEquals(verificationStamps(picture({})), { identity: null, payouts: null });
	assertEquals(
		verificationStamps(picture({ kycStatus: "verified" })),
		{ identity: "id_verified", payouts: null },
	);
	assertEquals(
		verificationStamps(picture({ payoutReady: true, payoutAccount: account("verified") })),
		{ identity: null, payouts: null },
	);
	assertEquals(
		verificationStamps(picture({ kycStatus: "verified", payoutAccount: account("verified") })),
		{ identity: "id_verified", payouts: "vault_verified" },
	);
});
