import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { type SimulatedCommit, simulatedOutcomeFor, type SimulationFacts } from "./simulation.ts";

/**
 * simulation — every would-be outcome is one sentence about what a BUYER would now do, quotes the
 * listing's own price, and claims escrow only for a format that escrows at checkout.
 */

const ONE_OFF: SimulationFacts = {
	title: "Brand identity sprint",
	sellerName: "Ivy",
	price: "$480",
	isFloor: false,
	format: "one_off",
	escrows: false,
	stageCount: 1,
};

const SESSION: SimulationFacts = { ...ONE_OFF, format: "session", escrows: true, stageCount: 0 };

Deno.test("outcome: a one-off pays its price into escrow and lands on Project setup", () => {
	assertEquals(
		simulatedOutcomeFor({ kind: "configure", wholeEngagement: false }, ONE_OFF),
		"A buyer would now pay $480 into escrow at checkout and land on Project setup.",
	);
	const staged = { ...ONE_OFF, stageCount: 3 };
	assertStringIncludes(
		simulatedOutcomeFor({ kind: "configure", wholeEngagement: false }, staged),
		"fund stage 1 of 3",
	);
	assertStringIncludes(
		simulatedOutcomeFor({ kind: "configure", wholeEngagement: true }, staged),
		"pay $480",
	);
});

Deno.test("outcome: escrow is claimed only where the format escrows", () => {
	assertStringIncludes(simulatedOutcomeFor({ kind: "book_session" }, SESSION), "into escrow");
	assert(
		!simulatedOutcomeFor({ kind: "buy_now" }, { ...ONE_OFF, format: "product" }).includes("escrow"),
	);
	assert(!simulatedOutcomeFor({ kind: "add_to_basket" }, ONE_OFF).includes("escrow"));
});

Deno.test("outcome: a floor price says so, and a quoted listing names no figure", () => {
	assertStringIncludes(
		simulatedOutcomeFor({ kind: "add_to_basket" }, { ...ONE_OFF, isFloor: true }),
		"from $480",
	);
	assertStringIncludes(
		simulatedOutcomeFor({ kind: "buy_now" }, { ...ONE_OFF, price: null }),
		"the quoted price",
	);
});

Deno.test("outcome: every commit reads as a would-be, never as done", () => {
	const commits: SimulatedCommit[] = [
		{ kind: "buy_now" },
		{ kind: "add_to_basket" },
		{ kind: "instantiate_pipeline" },
		{ kind: "archive_draft" },
		{ kind: "book_session", seats: 2 },
		{ kind: "discovery_call", minutes: 20 },
		{ kind: "configure", wholeEngagement: true },
		{ kind: "custom_quote" },
		{ kind: "ask_question" },
		{ kind: "save" },
		{ kind: "collection" },
		{ kind: "share" },
	];
	for (const commit of commits) {
		const sentence = simulatedOutcomeFor(commit, SESSION);
		assertStringIncludes(sentence, "would now", commit.kind);
		assert(sentence.endsWith("."), commit.kind);
	}
	assertStringIncludes(
		simulatedOutcomeFor({ kind: "discovery_call", minutes: 20 }, SESSION),
		"20-minute call",
	);
	assertStringIncludes(
		simulatedOutcomeFor({ kind: "book_session", seats: 2 }, { ...SESSION, format: "cohort" }),
		"hold 2 seats",
	);
});
