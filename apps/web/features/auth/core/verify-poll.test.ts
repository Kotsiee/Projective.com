import { assertEquals } from "@std/assert";
import { simulatedPollResult, verifyPollOutcome } from "./verify-poll.ts";

Deno.test("verifyPollOutcome waits on anything short of a confirmed answer", () => {
	assertEquals(verifyPollOutcome({ ok: false, message: "Too many checks" }), "pending");
	assertEquals(verifyPollOutcome({ ok: true, verified: false }), "pending");
	assertEquals(verifyPollOutcome({ ok: true }), "pending");
});

Deno.test("verifyPollOutcome continues only when this browser holds a session", () => {
	assertEquals(verifyPollOutcome({ ok: true, verified: true, signedIn: true }), "continue");
	assertEquals(verifyPollOutcome({ ok: true, verified: true, signedIn: false }), "sign_in");
	assertEquals(verifyPollOutcome({ ok: true, verified: true }), "sign_in");
});

Deno.test("simulatedPollResult stands in for each switcher position, and defers on auto", () => {
	assertEquals(simulatedPollResult("auto", "/home"), null);
	assertEquals(verifyPollOutcome(simulatedPollResult("pending", "/home")!), "pending");
	assertEquals(verifyPollOutcome(simulatedPollResult("confirmed", "/home")!), "sign_in");
	assertEquals(verifyPollOutcome(simulatedPollResult("confirmed_signed_in", "/home")!), "continue");
});
