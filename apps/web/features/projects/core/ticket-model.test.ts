import { assertEquals } from "@std/assert";
import { formatTicketMoney, TICKET_MAX_STAGES } from "@projective/types/projects";
import type { BoardStageRef } from "@projective/types/projects";
import {
	applyTicketIntensity,
	INTENSITY_OPTIONS,
	newTicketCard,
	patchStageDue,
	priceMultiplierText,
	seedStageSelection,
	stageIntensityOptions,
	ticketCommitPayload,
	ticketDueMode,
	ticketTotals,
} from "./ticket-model.ts";

/**
 * The stage SEED rule (Decision: board-composed tickets default to the whole pipeline).
 *
 * These pin a default nobody chose, which is the reason they are worth writing: a wrong seed does
 * not break a layout or fail a type-check — it silently prices a ticket against work the client
 * never selected, and the first sign of it is a total that disagrees with what they meant to buy.
 */

function stageOf(n: number): BoardStageRef {
	return {
		id: `stg-${n}`,
		slug: `stg-slug-${n}`,
		name: `Stage ${n}`,
		order: n,
		status: "active",
		locked: false,
		description: "",
		unitPriceCents: 10_000 * (n + 1),
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		funding: null,
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
		chainReaction: true,
		startAt: null,
		endAt: null,
		dependsOnStageId: null,
	};
}

const STAGES = [stageOf(0), stageOf(1), stageOf(2)];

Deno.test("a stage column seeds itself, whoever opens it", () => {
	for (const selectAll of [true, false]) {
		const seeded = seedStageSelection("stg-1", STAGES, selectAll);
		assertEquals(seeded.map((s) => s.id), ["stg-1"]);
	}
});

Deno.test("the New lane seeds the whole pipeline for an owning seat, in board order", () => {
	assertEquals(
		seedStageSelection(null, STAGES, true).map((s) => s.id),
		["stg-0", "stg-1", "stg-2"],
	);
});

Deno.test("the New lane seeds nothing for a seat without the right", () => {
	assertEquals(seedStageSelection(null, STAGES, false), []);
});

Deno.test("an origin stage the engagement does not have seeds nothing", () => {
	assertEquals(seedStageSelection("stg-gone", STAGES, true), []);
});

Deno.test("the seed never exceeds what the write payload accepts", () => {
	const many = Array.from({ length: TICKET_MAX_STAGES + 7 }, (_, i) => stageOf(i));
	assertEquals(seedStageSelection(null, many, true).length, TICKET_MAX_STAGES);
});

Deno.test("a New-lane ticket carries the seeded pipeline, ordered and priced", () => {
	const card = newTicketCard(null, STAGES, "USD", null, { selectAllStages: true });
	assertEquals(card.stages.map((s) => s.stageId), ["stg-0", "stg-1", "stg-2"]);
	assertEquals(card.stages.map((s) => s.order), [0, 1, 2]);
	// Every ref is priced from the live stage, so the footer total is the sum and not a partial.
	assertEquals(card.stages.map((s) => s.costCents), [10_000, 20_000, 30_000]);
	assertEquals(card.budgetCents, 60_000);
	// The New lane is still the column it was created in — seeding stages never moves the ticket.
	assertEquals(card.stageId, null);
});

Deno.test("without the option a New-lane ticket is still composed empty", () => {
	const card = newTicketCard(null, STAGES, "USD");
	assertEquals(card.stages, []);
	assertEquals(card.budgetCents, null);
});

Deno.test("a draft prices in the board's currency, not dollars", () => {
	const card = newTicketCard(null, STAGES, "GBP", null, { selectAllStages: true });
	assertEquals(card.currency, "GBP");
	assertEquals(card.budgetLabel, "£600");
	assertEquals(ticketTotals(card).totalLabel, "£600");
});

Deno.test("formatTicketMoney follows the currency's minor-unit exponent", () => {
	assertEquals(formatTicketMoney(9_950, "USD"), "$99.50");
	assertEquals(formatTicketMoney(5_000, "JPY"), "¥5,000");
});

// #region Intensity terms
const FIXED: BoardStageRef = {
	...stageOf(3),
	id: "stg-fixed",
	defaultIntensity: "high",
	intensityLocked: true,
};
const TIERED: BoardStageRef = { ...stageOf(4), id: "stg-tiered", lowPriceCents: 20_000 };

Deno.test("a stage sold at one fixed intensity seeds and holds that intensity at its one price", () => {
	const card = newTicketCard(null, [FIXED, TIERED], "USD", null, { selectAllStages: true });
	assertEquals(card.stages.map((s) => s.intensity), ["high", "standard"]);
	assertEquals(card.stages[0].costCents, 40_000);
	const raised = applyTicketIntensity(card, "low", [FIXED, TIERED]);
	assertEquals(raised.stages.map((s) => s.intensity), ["high", "low"]);
	assertEquals(raised.stages.map((s) => s.costCents), [40_000, 20_000]);
	// Capacity follows the W_i scale (High 2 + Low 0.5), never the price scale.
	assertEquals(raised.workload, 2.5);
});

Deno.test("the ticket default prints its price multiplier; a stage prints the price it sets", () => {
	assertEquals(INTENSITY_OPTIONS.map((o) => o.label), [
		"Low (0.75×)",
		"Standard (1.0×)",
		"High (1.5×)",
	]);
	assertEquals(priceMultiplierText(1), "1.0×");
	assertEquals(stageIntensityOptions(TIERED, 50_000, "USD").map((o) => o.label), [
		"Low · $200",
		"Standard (1.0×) · $500",
		"High (1.5×) · $750",
	]);
	assertEquals(stageIntensityOptions(null, null, "USD")[0].label, "Low (0.75×)");
});
// #endregion

// #region Due dates
Deno.test("the due date is the ticket's own, its one stage's, or the latest of several", () => {
	assertEquals(ticketDueMode({ stages: [] }), "ticket");
	const one = newTicketCard("stg-1", STAGES, "USD");
	assertEquals(ticketDueMode(one), "stage");
	const many = newTicketCard(null, STAGES, "USD", null, { selectAllStages: true });
	assertEquals(ticketDueMode(many), "derived");
});

Deno.test("stage dates derive the ticket's, and clearing the last clears it", () => {
	const card = newTicketCard(null, STAGES, "USD", null, { selectAllStages: true });
	const a = patchStageDue(card, "stg-0", "2026-12-01", STAGES);
	const b = patchStageDue(a, "stg-2", "2026-12-09", STAGES);
	assertEquals(b.dueDate, "2026-12-09");
	assertEquals(ticketCommitPayload("prj-x", b.id, b).dueDate, "2026-12-09");
	assertEquals(ticketCommitPayload("prj-x", b.id, b).stages.map((s) => s.dueAt ?? null), [
		"2026-12-01",
		null,
		"2026-12-09",
	]);
	const c = patchStageDue(b, "stg-2", null, STAGES);
	assertEquals(c.dueDate, "2026-12-01");
	const d = patchStageDue(c, "stg-0", null, STAGES);
	assertEquals(d.dueDate, null);
	assertEquals(d.dueLabel, null);
});
// #endregion
