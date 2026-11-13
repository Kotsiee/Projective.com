import { assert, assertEquals } from "@std/assert";
import {
	defaultStageSelection,
	escrowGuaranteeLine,
	EscrowQuoteQuerySchema,
	fundableStageIds,
	fundingStageOf,
	listedStagesOf,
	needsStageSelector,
	PREPAID_TTL_HOURS,
	sameCurrencyMoney,
	STAGE_SELECTION_REFUSAL,
	stageSelectionRefusal,
	TICKET_FUNDING_BLOCK_SENTENCE,
	TicketFundingBlock,
	type TicketFundingPhase,
	type TicketFundingStage,
	TicketFundingStageSchema,
	ttlWindowLabel,
} from "./ticket-funding.ts";

function stage(stageId: string, order: number, phase: TicketFundingPhase, fundable: boolean): TicketFundingStage {
	return {
		stageId,
		slug: `stg-${stageId}`,
		name: stageId.toUpperCase(),
		order,
		stageStatus: "open",
		phase,
		amount: sameCurrencyMoney(10_000, "USD"),
		fundable,
	};
}

// #region The prepaid refund window (Decision #428)
Deno.test("a service waits 5 days for a claim, a client project 7", () => {
	assertEquals(PREPAID_TTL_HOURS.service, 120);
	assertEquals(PREPAID_TTL_HOURS.project, 168);
	assertEquals(ttlWindowLabel(PREPAID_TTL_HOURS.service), "5 days");
	assertEquals(ttlWindowLabel(PREPAID_TTL_HOURS.project), "7 days");
});

Deno.test("the window reads in whole days when it is whole days, else hours, never below one hour", () => {
	assertEquals(ttlWindowLabel(24), "1 day");
	assertEquals(ttlWindowLabel(36), "36 hours");
	assertEquals(ttlWindowLabel(1), "1 hour");
	assertEquals(ttlWindowLabel(0), "1 hour");
});

Deno.test("the guarantee line names the window", () => {
	assertEquals(
		escrowGuaranteeLine(120),
		"Held in escrow · Auto-refunded to your wallet if unclaimed after 5 days",
	);
	assertEquals(
		escrowGuaranteeLine(168),
		"Held in escrow · Auto-refunded to your wallet if unclaimed after 7 days",
	);
});
// #endregion

// #region The stage a ticket is funded in
Deno.test("the stage it sits in wins; a New ticket starts on its first stage by its own order", () => {
	const listed = [{ stageId: "b", order: 1 }, { stageId: "a", order: 0 }];
	assertEquals(fundingStageOf("c", listed), "c");
	assertEquals(fundingStageOf(null, listed), "a");
	assertEquals(fundingStageOf(null, [{ stageId: "x", order: 0 }, { stageId: "y", order: 0 }]), "x");
	assertEquals(fundingStageOf(null, []), null);
});

Deno.test("required_stages jsonb is read defensively", () => {
	assertEquals(
		listedStagesOf([{ stage_id: "a", order: 2 }, { stage_id: "" }, null, { order: 1 }, "x"]),
		[
			{ stageId: "a", order: 2 },
		],
	);
	assertEquals(listedStagesOf({ stage_id: "a" }), []);
	assertEquals(listedStagesOf([{ stage_id: "a" }]), [{ stageId: "a", order: 0 }]);
});
// #endregion

// #region Selection (Decision #430)
Deno.test("every stage the server marks fundable can be bought now, in the ticket's order", () => {
	const stages = [
		stage("c", 2, "later", true),
		stage("a", 0, "funded", false),
		stage("b", 1, "prepaid", false),
		stage("d", 3, "later", true),
	];
	assertEquals(fundableStageIds({ blocked: null, stages }), ["c", "d"]);
	assertEquals(fundableStageIds({ blocked: "finished", stages }), []);
});

Deno.test("a picker opens on the funding stage while it can be bought, else the first that can", () => {
	const fresh = [stage("a", 0, "now", true), stage("b", 1, "later", true)];
	assertEquals(defaultStageSelection({ blocked: null, stages: fresh, fundingStageId: "a" }), ["a"]);
	const held = [stage("a", 0, "funded", false), stage("b", 1, "later", true)];
	assertEquals(defaultStageSelection({ blocked: null, stages: held, fundingStageId: "a" }), ["b"]);
	assertEquals(defaultStageSelection({ blocked: "paid", stages: held, fundingStageId: "a" }), []);
});

Deno.test("a selection is refused when it names a stage that cannot be bought; none or fundable ones pass", () => {
	assertEquals(stageSelectionRefusal(["a"], undefined), null);
	assertEquals(stageSelectionRefusal(["a"], []), null);
	assertEquals(stageSelectionRefusal(["a", "b"], ["a", "b"]), null);
	assertEquals(stageSelectionRefusal(["a"], ["a", "b"]), STAGE_SELECTION_REFUSAL);
	assertEquals(stageSelectionRefusal([], ["a"]), STAGE_SELECTION_REFUSAL);
});

Deno.test("a stage carries whether it can be bought, defaulting to no", () => {
	const parsed = TicketFundingStageSchema.parse({
		stageId: "a",
		name: "A",
		order: 0,
		stageStatus: "open",
		phase: "prepaid",
		amount: null,
	});
	assertEquals(parsed.fundable, false);
	assertEquals(parsed.phase, "prepaid");
});

Deno.test("the selector opens for a ticket with several stages", () => {
	assert(!needsStageSelector(0));
	assert(!needsStageSelector(1));
	assert(needsStageSelector(2));
});

Deno.test("every block code has its sentence", () => {
	for (const code of TicketFundingBlock.options) {
		assert(TICKET_FUNDING_BLOCK_SENTENCE[code].length > 0, code);
	}
});
// #endregion

// #region Wire shapes
Deno.test("the quote query names a stage or a ticket, never both or neither", () => {
	assert(EscrowQuoteQuerySchema.safeParse({ project: "prj-1", stage: "stg-1" }).success);
	assert(EscrowQuoteQuerySchema.safeParse({ project: "prj-1", ticket: "tkt-1" }).success);
	assert(!EscrowQuoteQuerySchema.safeParse({ project: "prj-1" }).success);
	assert(!EscrowQuoteQuerySchema.safeParse({ project: "prj-1", stage: "s", ticket: "t" }).success);
});

Deno.test("a same-currency figure carries no FX origin", () => {
	const money = sameCurrencyMoney(40_000, "GBP");
	assertEquals([money.minor, money.currency, money.origin], [40_000, "GBP", null]);
	assertEquals(money.display, "£400.00");
});
// #endregion
