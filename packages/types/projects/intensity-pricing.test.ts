import { assertEquals } from "@std/assert";
import {
	INTENSITY_PRICE_MULTIPLIER,
	stageCostCents,
	stageDefaultIntensity,
	stageIntensityLocked,
	ticketCostLines,
	ticketDueFromStages,
	type TicketStageRef,
	workloadIntensity,
	WORKLOAD_MULTIPLIER,
} from "./board.ts";

/**
 * Intensity is one choice read on two axes: capacity ($W_i$, 0.5 / 1 / 2 — the caps are summed on
 * it) and price (0.75 / 1 / 1.5 of the stage rate, or the seller's own tier price, or one fixed price).
 * These pin the axes apart, because a single table for both is how a Low ticket came to cost half.
 */

function ref(over: Partial<TicketStageRef>): TicketStageRef {
	return {
		stageId: "stg-a",
		name: "Design",
		order: 0,
		status: "active",
		required: true,
		brief: "",
		intensity: "standard",
		tasks: [],
		parallel: false,
		costCents: null,
		unitPriceCents: 40_000,
		...over,
	};
}

Deno.test("capacity and price read intensity on separate scales", () => {
	assertEquals(WORKLOAD_MULTIPLIER, { low: 0.5, standard: 1, high: 2 });
	assertEquals(INTENSITY_PRICE_MULTIPLIER, { low: 0.75, standard: 1, high: 1.5 });
	assertEquals(workloadIntensity(1, "low"), 0.5);
	assertEquals(workloadIntensity(1, "high"), 2);
	assertEquals(stageCostCents(40_000, "low"), 30_000);
	assertEquals(stageCostCents(40_000, "high"), 60_000);
});

Deno.test("an unpriced stage stays unpriced at every intensity", () => {
	assertEquals(stageCostCents(null, "low"), null);
	assertEquals(stageCostCents(null, "high"), null);
});

Deno.test("the seller's own tier price wins where set; the multiplier answers the rest", () => {
	const terms = { lowPriceCents: 25_000, highPriceCents: null };
	assertEquals(stageCostCents(40_000, "low", terms), 25_000);
	assertEquals(stageCostCents(40_000, "standard", terms), 40_000);
	assertEquals(stageCostCents(40_000, "high", terms), 60_000);
});

Deno.test("a stage sold at one fixed intensity costs its rate, whatever is asked", () => {
	const terms = { intensityLocked: true, lowPriceCents: 1, highPriceCents: 999_999 };
	assertEquals(stageCostCents(40_000, "low", terms), 40_000);
	assertEquals(stageCostCents(40_000, "high", terms), 40_000);
});

Deno.test("absent stage terms read as standard and unlocked", () => {
	assertEquals(stageDefaultIntensity(null), "standard");
	assertEquals(stageDefaultIntensity({ defaultIntensity: "high" }), "high");
	assertEquals(stageIntensityLocked(undefined), false);
	assertEquals(stageIntensityLocked({ intensityLocked: true }), true);
});

Deno.test("the breakdown names how each line was priced", () => {
	const lines = ticketCostLines(
		[
			ref({ stageId: "stg-a", intensity: "high", order: 0 }),
			ref({ stageId: "stg-b", intensity: "low", order: 1 }),
			ref({ stageId: "stg-c", intensity: "high", order: 2 }),
		],
		[
			{ id: "stg-b", lowPriceCents: 22_000 },
			{ id: "stg-c", intensityLocked: true },
		],
	);
	assertEquals(lines.map((l) => [l.basis, l.costCents]), [
		["multiplier", 60_000],
		["seller_tier", 22_000],
		["fixed", 40_000],
	]);
	assertEquals(lines[0].multiplier, 1.5);
});

Deno.test("the ticket is due on its latest stage date, by calendar day", () => {
	assertEquals(ticketDueFromStages([]), null);
	assertEquals(ticketDueFromStages([{ dueAt: null }, {}]), null);
	assertEquals(
		ticketDueFromStages([
			{ dueAt: "2026-11-30" },
			{ dueAt: "2026-12-04T00:00:00+00:00" },
			{ dueAt: null },
		]),
		"2026-12-04",
	);
});
