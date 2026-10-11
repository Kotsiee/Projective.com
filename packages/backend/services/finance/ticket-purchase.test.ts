import { assertEquals } from "@std/assert";
import { type TicketFact, ticketKindOf, ticketPurchase } from "./live-basket.ts";

/*
 * Single-ticket purchase (Decision #166) — the basket's pricing and gates for ONE board ticket, the
 * same rules `projects.fund_ticket` applies at payment. The SQL ledger itself is exercised by
 * `supabase/probes/single_ticket_purchase.sql` against a migrated database.
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
	const bought = ticketPurchase(
		tickets.find((t) => t.id === boughtId)!,
		STAGE,
		PROJECT,
		OWNER,
		false,
	);
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
		ticketPurchase(after.find((t) => t.id === id)!, STAGE, PROJECT, OWNER, false);
	assertEquals(again("b").closed, "This ticket is already paid for.");
	assertEquals(again("a"), { price: { minor: 10_000, currency: "USD" }, closed: null });
	assertEquals(again("c"), { price: { minor: 30_000, currency: "USD" }, closed: null });
});

Deno.test("the purchasing gate: a ticket with no description is not purchasable", () => {
	const out = ticketPurchase(
		ticket("d", { text_description: "   " }),
		STAGE,
		PROJECT,
		OWNER,
		false,
	);
	assertEquals(out.closed, "Add a description to this ticket before it can be bought.");
});

Deno.test("an unclaimed ticket waits for a payee unless its stage holds a team seat", () => {
	const unclaimed = ticket("e", { current_assignee_id: null });
	assertEquals(
		ticketPurchase(unclaimed, STAGE, PROJECT, OWNER, false).closed,
		"Nobody can be paid for this ticket yet — it can be bought once it's claimed.",
	);
	assertEquals(ticketPurchase(unclaimed, STAGE, PROJECT, OWNER, true).closed, null);
});

Deno.test("only the project's own client pays: its business, else its owner as an individual", () => {
	const business = { ownerType: "business" as const, ownerId: "biz", isEntity: true };
	const ofBusiness = { ...PROJECT, client_business_id: "biz" };
	assertEquals(ticketPurchase(ticket("f"), STAGE, ofBusiness, business, false).closed, null);
	assertEquals(
		ticketPurchase(ticket("f"), STAGE, ofBusiness, OWNER, false).closed,
		"Pay for this ticket from the account that owns its project.",
	);
	assertEquals(
		ticketPurchase(ticket("f"), STAGE, PROJECT, { ...OWNER, ownerId: "stranger" }, false).closed,
		"Pay for this ticket from the account that owns its project.",
	);
});

Deno.test("a moved, unpriced or finished-stage ticket says why it can't be bought", () => {
	assertEquals(
		ticketPurchase(ticket("g", { current_stage_id: "stage-2" }), STAGE, PROJECT, OWNER, false)
			.closed,
		"This ticket moved to another stage — remove it and add it again.",
	);
	assertEquals(
		ticketPurchase(ticket("h"), { ...STAGE, unitPriceCents: null }, PROJECT, OWNER, false),
		{ price: null, closed: "This ticket isn't priced yet." },
	);
	assertEquals(
		ticketPurchase(ticket("i"), { ...STAGE, status: "approved" }, PROJECT, OWNER, false).closed,
		"That stage has finished.",
	);
	assertEquals(
		ticketPurchase(ticket("j", { payment_status: "needs_funding" }), STAGE, PROJECT, OWNER, false)
			.closed,
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
