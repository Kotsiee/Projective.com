import { assertEquals } from "@std/assert";
import { lockLinkLabel, lockNextStep } from "./verification-lock-copy.ts";

/**
 * `VerificationLock`'s next step per kind × state × right: a pending check asks nothing of anyone,
 * only a business's billing holder is pointed at a module that lists what is due (a team's is not
 * built), a viewer who cannot open Verification is told who can, and no duration is ever promised.
 */

Deno.test("lock: pending asks nothing, and only a business's billing holder is sent to the module", () => {
	assertEquals(
		lockNextStep("business", "pending", true),
		"The Verification page shows anything still outstanding.",
	);
	for (const [kind, canManage] of [["business", false], ["team", true], ["team", false]] as const) {
		assertEquals(
			lockNextStep(kind, "pending", canManage),
			"Nothing else is needed from you meanwhile.",
			`${kind} / ${canManage}`,
		);
	}
});

Deno.test("lock: an unverified entity names who acts, or what still works for the one who can", () => {
	assertEquals(
		lockNextStep("business", "unverified", false),
		"Ask the owner to verify the business.",
	);
	assertEquals(
		lockNextStep("team", "unverified", false),
		"An owner or admin can finish KYC from the team's Verification page.",
	);
	// Plan-neutral: a Business Free owner, who cannot set limits, reads the same lock (Decision #248).
	assertEquals(
		lockNextStep("business", "unverified", true),
		"Everything else keeps working — only spending from the wallet waits on this.",
	);
	assertEquals(/limit|rule/i.test(lockNextStep("business", "unverified", true)), false);
	assertEquals(
		lockNextStep("team", "unverified", true),
		"Everything else keeps working — only the payout itself waits on this.",
	);
});

Deno.test("lock: no sentence promises a duration", () => {
	for (const kind of ["team", "business"] as const) {
		for (const state of ["unverified", "pending"] as const) {
			for (const canManage of [true, false]) {
				const text = lockNextStep(kind, state, canManage);
				assertEquals(/day|hour|week/i.test(text), false, text);
			}
		}
	}
});

Deno.test("lock: the link label is an instruction per state", () => {
	assertEquals(lockLinkLabel("business", "pending"), "See what's outstanding");
	assertEquals(lockLinkLabel("business", "unverified"), "Finish KYB");
	assertEquals(lockLinkLabel("team", "unverified"), "Finish KYC");
});
