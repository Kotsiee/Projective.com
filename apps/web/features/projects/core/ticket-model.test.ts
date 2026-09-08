import { assertEquals } from "@std/assert";
import { TICKET_MAX_STAGES } from "@projective/types/projects";
import type { BoardStageRef } from "@projective/types/projects";
import { newTicketCard, seedStageSelection } from "./ticket-model.ts";

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
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
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
	const card = newTicketCard(null, STAGES, null, { selectAllStages: true });
	assertEquals(card.stages.map((s) => s.stageId), ["stg-0", "stg-1", "stg-2"]);
	assertEquals(card.stages.map((s) => s.order), [0, 1, 2]);
	// Every ref is priced from the live stage, so the footer total is the sum and not a partial.
	assertEquals(card.stages.map((s) => s.costCents), [10_000, 20_000, 30_000]);
	assertEquals(card.budgetCents, 60_000);
	// The New lane is still the column it was created in — seeding stages never moves the ticket.
	assertEquals(card.stageId, null);
});

Deno.test("without the option a New-lane ticket is still composed empty", () => {
	const card = newTicketCard(null, STAGES);
	assertEquals(card.stages, []);
	assertEquals(card.budgetCents, null);
});
