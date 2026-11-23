import { assertEquals, assertStringIncludes } from "@std/assert";
import { safetyHoldSentence } from "./aml-signals.ts";

Deno.test("safetyHoldSentence: the hold's end in plain words, in UTC, naming no trigger", () => {
	const sentence = safetyHoldSentence("2026-11-26T14:05:31.123+00:00");
	assertEquals(
		sentence,
		"For your security, withdrawals from this account are paused until 26 November 2026 at 14:05 UTC. Your money stays in your wallet, and you can withdraw it after then.",
	);
	assertStringIncludes(safetyHoldSentence("2026-12-31T23:59:00Z"), "31 December 2026 at 23:59 UTC");
});
