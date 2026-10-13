import { assertEquals, assertStringIncludes } from "@std/assert";
import type { StageFundingQuote } from "@projective/types/finance";
import { stageFundingPlan, stageLockSentence } from "./stage-funding.ts";

function quote(over: Partial<StageFundingQuote> = {}): StageFundingQuote {
	return {
		projectId: "00000000-0000-4000-8000-000000000001",
		stageId: "00000000-0000-4000-8000-000000000002",
		stageName: "Discovery",
		stageStatus: "open",
		fundable: true,
		ticketCount: 3,
		unpricedCount: 0,
		amountMinor: 120_000,
		currency: "USD",
		payer: { scope: "business", id: "00000000-0000-4000-8000-000000000003" },
		walletBalanceMinor: 500_000,
		...over,
	};
}

Deno.test("a wallet that covers the stage is offered first, the card always", () => {
	const plan = stageFundingPlan(quote());
	assertEquals(plan.blocked, null);
	assertEquals(plan.methods, ["wallet", "card"]);
	assertEquals(plan.ticketsLine, "3 tickets at their agreed prices");
	assertStringIncludes(plan.walletLabel, "Business wallet");
});

Deno.test("a wallet short of the stage leaves only the card — fund_stage is all or nothing", () => {
	assertEquals(stageFundingPlan(quote({ walletBalanceMinor: 119_999 })).methods, ["card"]);
	assertEquals(stageFundingPlan(quote({ walletBalanceMinor: 120_000 })).methods, [
		"wallet",
		"card",
	]);
});

Deno.test("an individual payer's wallet is named as their own", () => {
	const plan = stageFundingPlan(
		quote({ payer: { scope: "personal", id: "00000000-0000-4000-8000-000000000004" } }),
	);
	assertStringIncludes(plan.walletLabel, "Your wallet");
});

Deno.test("unpriced tickets block both methods before anything is charged", () => {
	const one = stageFundingPlan(quote({ unpricedCount: 1 }));
	assertEquals(one.methods, []);
	assertStringIncludes(one.blocked ?? "", "A ticket in this stage has no price yet");
	assertStringIncludes(stageFundingPlan(quote({ unpricedCount: 2 })).blocked ?? "", "2 tickets");
});

Deno.test("a finished stage, or one with nothing waiting, cannot be funded", () => {
	assertStringIncludes(
		stageFundingPlan(quote({ fundable: false, stageStatus: "paid" })).blocked ?? "",
		"finished",
	);
	assertStringIncludes(
		stageFundingPlan(quote({ amountMinor: 0, ticketCount: 0 })).blocked ?? "",
		"Nothing",
	);
});

Deno.test("each outcome says where the money is", () => {
	assertStringIncludes(stageLockSentence("locked"), "held");
	assertStringIncludes(stageLockSentence("declined"), "Nothing was charged");
	assertStringIncludes(
		stageLockSentence("lock_failed", "A ticket has no price yet."),
		"The money is in your wallet",
	);
	assertStringIncludes(stageLockSentence("timeout"), "as soon as it clears");
});
