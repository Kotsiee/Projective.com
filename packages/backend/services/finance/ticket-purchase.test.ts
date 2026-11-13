import { assertEquals } from "@std/assert";
import {
	type TicketFact,
	ticketFundingStageId,
	ticketKindOf,
	ticketPurchase,
	ticketStagePriceCents,
	ticketStageRefusal,
} from "./live-basket.ts";

/*
 * Single-ticket purchase (Decision #166) — the basket's pricing and gates for ONE board ticket, the
 * same rules `projects.fund_ticket` applies at payment. The SQL ledger itself is exercised by
 * `supabase/probes/single_ticket_purchase.sql` and `prepaid_escrow_ttl.sql` against a migrated database.
 */

// #region Fixtures
const STAGE = { id: "stage-1", status: "in_progress", unitPriceCents: 25_000 };
const PROJECT = { client_business_id: null, owner_user_id: "owner", currency: "USD" };
const OWNER = { ownerType: "user" as const, ownerId: "owner", isEntity: false };

function ticket(id: string, patch: Partial<TicketFact> = {}): TicketFact {
	return {
		id,
		slug: `tkt-${id}`,
		project_id: "project",
		title: `Ticket ${id}`,
		text_description: "Build the thing.",
		payment_status: "unpaid",
		current_stage_id: STAGE.id,
		current_assignee_id: "freelancer",
		unit_price_cents: null,
		...patch,
	};
}

/** What buying ONE ticket holds, and what the stage still owes — the ledger a purchase leaves. */
function ledgerAfterBuying(tickets: TicketFact[], boughtId: string) {
	const bought = ticketPurchase(tickets.find((t) => t.id === boughtId)!, STAGE, PROJECT, OWNER);
	const after = tickets.map((t) =>
		t.id === boughtId ? { ...t, payment_status: "escrow_funded" } : t
	);
	const held = after.filter((t) => t.payment_status === "escrow_funded")
		.map((t) => Number(t.unit_price_cents ?? STAGE.unitPriceCents));
	const owed = after.filter((t) => t.payment_status === "unpaid")
		.map((t) => Number(t.unit_price_cents ?? STAGE.unitPriceCents));
	return { bought, after, held, owed };
}
// #endregion

Deno.test("funding one ticket of three holds only that ticket's price; the stage stays partially funded", () => {
	const tickets = [
		ticket("a", { unit_price_cents: 10_000 }),
		ticket("b"), // no own price → the stage's
		ticket("c", { unit_price_cents: 30_000 }),
	];
	const { bought, after, held, owed } = ledgerAfterBuying(tickets, "b");

	// The amount is B's alone (the stage's price, since B has none) — never the stage's 65,000 sum.
	assertEquals(bought, { price: { minor: 25_000, currency: "USD" }, closed: null });
	assertEquals(held, [25_000]);
	assertEquals(owed, [10_000, 30_000]);
	assertEquals(held.reduce((s, n) => s + n, 0) + owed.reduce((s, n) => s + n, 0), 65_000);

	// Partially funded: B can't be bought twice, A and C still can — each at its own price.
	const again = (id: string) =>
		ticketPurchase(after.find((t) => t.id === id)!, STAGE, PROJECT, OWNER);
	assertEquals(again("b").closed, "This ticket is already paid for.");
	assertEquals(again("a"), { price: { minor: 10_000, currency: "USD" }, closed: null });
	assertEquals(again("c"), { price: { minor: 30_000, currency: "USD" }, closed: null });
});

Deno.test("the purchasing gate: a ticket with no description is not purchasable", () => {
	const out = ticketPurchase(ticket("d", { text_description: "   " }), STAGE, PROJECT, OWNER);
	assertEquals(out.closed, "Add a description to this ticket before it can be bought.");
});

Deno.test("an unclaimed ticket is bought prepaid: nobody need hold it yet (Decision #197)", () => {
	const unclaimed = ticket("e", { current_assignee_id: null });
	assertEquals(ticketPurchase(unclaimed, STAGE, PROJECT, OWNER), {
		price: { minor: 25_000, currency: "USD" },
		closed: null,
	});
});

Deno.test("a New ticket is bought in the first stage it lists, by its own order (Decision #428)", () => {
	const fresh = ticket("n", {
		current_stage_id: null,
		current_assignee_id: null,
		required_stages: [{ stage_id: "stage-2", order: 1 }, { stage_id: STAGE.id, order: 0 }],
	});
	assertEquals(ticketFundingStageId(fresh), STAGE.id);
	assertEquals(ticketPurchase(fresh, STAGE, PROJECT, OWNER).closed, null);
	// Its later stage can be prepaid alongside (Decision #430).
	assertEquals(ticketPurchase(fresh, { ...STAGE, id: "stage-2" }, PROJECT, OWNER).closed, null);
	const stageless = ticket("o", { current_stage_id: null, required_stages: [] });
	assertEquals(ticketFundingStageId(stageless), null);
	assertEquals(
		ticketPurchase(stageless, null, PROJECT, OWNER).closed,
		"Add a stage to this ticket before it can be bought.",
	);
});

Deno.test("only the project's own client pays: its business, else its owner as an individual", () => {
	const business = { ownerType: "business" as const, ownerId: "biz", isEntity: true };
	const ofBusiness = { ...PROJECT, client_business_id: "biz" };
	assertEquals(ticketPurchase(ticket("f"), STAGE, ofBusiness, business).closed, null);
	assertEquals(
		ticketPurchase(ticket("f"), STAGE, ofBusiness, OWNER).closed,
		"Pay for this ticket from the account that owns its project.",
	);
	assertEquals(
		ticketPurchase(ticket("f"), STAGE, PROJECT, { ...OWNER, ownerId: "stranger" }).closed,
		"Pay for this ticket from the account that owns its project.",
	);
});

Deno.test("a stage the ticket no longer runs through, unpriced or finished says why it can't be bought", () => {
	assertEquals(
		ticketPurchase(ticket("g", { current_stage_id: "stage-2" }), STAGE, PROJECT, OWNER).closed,
		"This ticket no longer runs through this stage — remove it from your basket.",
	);
	assertEquals(
		ticketPurchase(ticket("h"), { ...STAGE, unitPriceCents: null }, PROJECT, OWNER),
		{ price: null, closed: "This ticket isn't priced yet." },
	);
	assertEquals(
		ticketPurchase(ticket("i"), { ...STAGE, status: "approved" }, PROJECT, OWNER).closed,
		"That stage has finished.",
	);
	assertEquals(
		ticketPurchase(ticket("j", { payment_status: "needs_funding" }), STAGE, PROJECT, OWNER).closed,
		null,
	);
});

Deno.test("a ticket is bought as its project's kind", () => {
	assertEquals(
		ticketKindOf({ format: "pipeline", structure_variation: "standard" }),
		"project_ticket",
	);
	assertEquals(
		ticketKindOf({ format: "one_off", structure_variation: "single_task" }),
		"one_off_task",
	);
	assertEquals(
		ticketKindOf({ format: "one_off", structure_variation: "one_off" }),
		"one_off_project",
	);
});

// #region Stages bought one by one (Decision #430)
const LISTED = [{ stage_id: STAGE.id, order: 0 }, { stage_id: "stage-2", order: 1 }];

Deno.test("each stage is priced at the ticket's intensity there, by the seller's own tier terms", () => {
	const at = (intensity: string) =>
		ticket("p", { required_stages: [{ stage_id: STAGE.id, order: 0, intensity }] });
	assertEquals(ticketStagePriceCents(at("standard"), STAGE), 25_000);
	assertEquals(ticketStagePriceCents(at("high"), STAGE), 37_500);
	assertEquals(ticketStagePriceCents(at("low"), STAGE), 18_750);
	assertEquals(ticketStagePriceCents(at("high"), { ...STAGE, highPriceCents: 40_000 }), 40_000);
	assertEquals(ticketStagePriceCents(at("high"), { ...STAGE, intensityLocked: true }), 25_000);
	assertEquals(ticketStagePriceCents(at("high"), { ...STAGE, unitPriceCents: null }), null);
});

Deno.test("a stage the ticket has moved past is refused; a later one can be prepaid", () => {
	const inSecond = ticket("q", { current_stage_id: "stage-2", required_stages: LISTED });
	assertEquals(ticketStageRefusal(inSecond, STAGE), "passed");
	assertEquals(
		ticketPurchase(inSecond, STAGE, PROJECT, OWNER).closed,
		"This ticket has moved past this stage — remove it from your basket.",
	);
	const inFirst = ticket("r", { required_stages: LISTED });
	assertEquals(ticketStageRefusal(inFirst, { ...STAGE, id: "stage-2" }), null);
});

Deno.test("a prepaid stage and a held funding stage are already paid for", () => {
	const t = ticket("s", { required_stages: LISTED });
	const escrows = { held: true, reservedStageIds: new Set(["stage-2"]) };
	assertEquals(ticketStageRefusal(t, STAGE, escrows), "held");
	assertEquals(ticketPurchase(t, STAGE, PROJECT, OWNER, escrows).closed, "This ticket is already paid for.");
	assertEquals(ticketStageRefusal(t, { ...STAGE, id: "stage-2" }, escrows), "prepaid");
	assertEquals(
		ticketPurchase(t, { ...STAGE, id: "stage-2" }, PROJECT, OWNER, escrows).closed,
		"This stage is already paid for — remove it from your basket.",
	);
});

Deno.test("a ticket sitting in a stage it does not list is bought there (#421)", () => {
	const unlisted = ticket("u", { required_stages: [] });
	assertEquals(ticketStageRefusal(unlisted, STAGE), null);
	assertEquals(ticketStageRefusal(unlisted, { ...STAGE, id: "stage-2" }), "not_listed");
});
// #endregion
