import { assertEquals } from "@std/assert";
import type { FairExitPreview, FairExitQuote, FairExitTier } from "../types/projects-types.ts";
import {
	blockedText,
	canConfirmFairExit,
	DEFAULT_FAIR_EXIT_TIER,
	FAIR_EXIT_TIER_OPTIONS,
	fairExitConsequences,
	parseFairExitTier,
	quoteFor,
} from "./fair-exit-model.ts";

/*
 * The Fair Exit confirmation (Decision #198) renders server figures and decides only which quote to
 * show and when the confirm may fire. A wrong answer here would show one tier's money under another
 * tier's label, or let a refused exit be sent.
 */

// #region Fixtures
function quote(tier: FairExitTier): FairExitQuote {
	return {
		tier,
		ticketCount: 2,
		freelancerPaidCents: tier * 100,
		feeCents: tier,
		clientRefundedCents: 10000 - tier * 100,
		freelancerPaidLabel: `$${tier}.00`,
		feeLabel: `$0.${tier}`,
		clientRefundedLabel: `$${100 - tier}.00`,
	};
}

function preview(over: Partial<FairExitPreview> = {}): FairExitPreview {
	return {
		stageId: "stg-1",
		stageName: "Brand system",
		currency: "USD",
		exitable: true,
		blocked: null,
		heldCents: 10000,
		heldLabel: "$100.00",
		prepaidCents: 0,
		prepaidLabel: "$0.00",
		ticketsToCancel: 2,
		tiers: [quote(25), quote(50), quote(75)],
		...over,
	};
}
// #endregion

Deno.test("the switch offers exactly the three tiers the door accepts, opening on the middle one", () => {
	assertEquals(FAIR_EXIT_TIER_OPTIONS.map((o) => parseFairExitTier(o.value)), [25, 50, 75]);
	assertEquals(DEFAULT_FAIR_EXIT_TIER, 50);
});

Deno.test("only the three tier values parse", () => {
	assertEquals(parseFairExitTier("25"), 25);
	assertEquals(parseFairExitTier(["75"]), 75);
	for (const bad of ["", "40", "100", "50%", null, undefined, []]) {
		assertEquals(parseFairExitTier(bad as string | null), null, String(bad));
	}
});

Deno.test("the quote shown is the chosen tier's own, never a neighbour's", () => {
	const p = preview({ tiers: [quote(75), quote(25), quote(50)] });
	assertEquals(quoteFor(p, 25)?.freelancerPaidLabel, "$25.00");
	assertEquals(quoteFor(p, 75)?.clientRefundedLabel, "$25.00");
	assertEquals(quoteFor(null, 50), null);
	assertEquals(quoteFor(p, null), null);
});

Deno.test("the confirm fires only on an exitable preview, a known tier, nothing in flight", () => {
	assertEquals(canConfirmFairExit(preview(), 50, false), true);
	assertEquals(canConfirmFairExit(preview(), 50, true), false);
	assertEquals(canConfirmFairExit(preview(), null, false), false);
	assertEquals(canConfirmFairExit(null, 50, false), false);
	assertEquals(
		canConfirmFairExit(preview({ exitable: false, blocked: "settled" }), 50, false),
		false,
	);
	assertEquals(
		canConfirmFairExit(preview({ tiers: [quote(25), quote(75), quote(75)] }), 50, false),
		false,
	);
});

Deno.test("a blocked stage says why in words, per reason", () => {
	assertEquals(blockedText("settled").includes("already settled"), true);
	assertEquals(blockedText("nothing_held").includes("Nothing is held"), true);
});

Deno.test("the consequences name the tickets that close and the prepaid money that returns", () => {
	assertEquals(fairExitConsequences(preview({ ticketsToCancel: 0 })), []);
	assertEquals(fairExitConsequences(preview({ ticketsToCancel: 1 })), [
		"1 open ticket on this stage will be cancelled",
	]);
	assertEquals(
		fairExitConsequences(preview({ ticketsToCancel: 3, prepaidCents: 500, prepaidLabel: "$5.00" })),
		[
			"3 open tickets on this stage will be cancelled",
			"$5.00 prepaid for unclaimed tickets comes back in full",
		],
	);
});
