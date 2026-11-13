import { assertEquals } from "@std/assert";
import { BoardCardSchema, TicketStageRefSchema } from "@projective/types/projects";
import { fixtureTicketQuote, ticketFundingQuoteOf } from "./ticket-funding.ts";

/*
 * The ticket funding quote (Decision #428): the database row mapped onto the SSOT, and the dev fixture
 * built from a stub board card. The SQL read itself is `supabase/probes/prepaid_escrow_ttl.sql`.
 */

// #region Fixtures
const stage = (stageId: string, order: number, costCents: number | null) =>
	TicketStageRefSchema.parse({
		stageId,
		name: `Stage ${stageId}`,
		order,
		status: "active",
		required: true,
		costCents,
	});

function card(over: Record<string, unknown> = {}) {
	return BoardCardSchema.parse({
		id: "tkt-1",
		slug: "tkt-aaaaaaaaaa",
		title: "Ship the icon set",
		description: "Icons",
		hasDescription: true,
		status: "backlog",
		stageId: null,
		assignee: null,
		claimed: false,
		escrowHeld: false,
		priority: "normal",
		intensity: "standard",
		workload: 1,
		dueDate: null,
		dueLabel: null,
		budgetCents: 100_000,
		budgetLabel: "£1,000",
		frozen: false,
		commentCount: 0,
		attachmentCount: 0,
		checklistDone: 0,
		checklistTotal: 0,
		updatedAt: "2026-10-01T00:00:00.000Z",
		dateLabel: "Oct 1",
		sortOrder: 0,
		currency: "GBP",
		stages: [stage("b", 1, 60_000), stage("a", 0, 40_000)],
		...over,
	});
}
// #endregion

Deno.test("fixture: a New ticket's first stage is held now, and each later stage can be prepaid (#430)", () => {
	const quote = fixtureTicketQuote(card(), "project", "prj-1");
	assertEquals(quote.fundingStageId, "a");
	assertEquals(quote.amount.minor, 40_000);
	assertEquals(quote.amount.display, "£400.00");
	assertEquals(quote.stages.map((s) => [s.stageId, s.phase, s.amount?.minor, s.fundable]), [
		["a", "now", 40_000, true],
		["b", "later", 60_000, true],
	]);
	assertEquals([quote.blocked, quote.escrowTtlHours, quote.engagement], [null, 168, "project"]);
});

Deno.test("fixture: a held stage and a prepaid one are paid for; the rest stays fundable", () => {
	const funding = {
		state: "funded",
		amountMinor: 40_000,
		currency: "GBP",
		amountLabel: "£400.00",
		canStart: true,
		nextAction: "start_work",
		reason: null,
	};
	const three = [stage("a", 0, 40_000), stage("b", 1, 60_000), stage("c", 2, 25_000)];
	const some = fixtureTicketQuote(
		card({ escrowHeld: true, stageId: "a", stages: three, funding: { ...funding, prepaidStageIds: ["b"] } }),
		"project",
		"p",
	);
	assertEquals(some.stages.map((s) => [s.phase, s.fundable]), [
		["funded", false],
		["prepaid", false],
		["later", true],
	]);
	assertEquals(some.blocked, null);
	const all = fixtureTicketQuote(
		card({ escrowHeld: true, stageId: "a", stages: three, funding: { ...funding, prepaidStageIds: ["b", "c"] } }),
		"project",
		"p",
	);
	assertEquals(all.blocked, "paid");
});

Deno.test("fixture: a service waits 120h; a ticket in its second stage shows the first as done", () => {
	const quote = fixtureTicketQuote(card({ stageId: "b", status: "todo" }), "service", "prj-1");
	assertEquals(quote.escrowTtlHours, 120);
	assertEquals(quote.stages.map((s) => s.phase), ["done", "now"]);
	assertEquals(quote.amount.minor, 60_000);
});

Deno.test("fixture: blocked in fund_ticket's order", () => {
	assertEquals(
		fixtureTicketQuote(card({ hasDescription: false }), "project", "p").blocked,
		"description",
	);
	assertEquals(
		fixtureTicketQuote(card({ status: "completed" }), "project", "p").blocked,
		"finished",
	);
	assertEquals(
		fixtureTicketQuote(card({ escrowHeld: true, stages: [stage("a", 0, 40_000)] }), "project", "p").blocked,
		"paid",
	);
	assertEquals(fixtureTicketQuote(card({ stages: [] }), "project", "p").blocked, "no_stage");
	assertEquals(
		fixtureTicketQuote(card({ stages: [stage("a", 0, null)] }), "project", "p").blocked,
		"unpriced",
	);
	const held = fixtureTicketQuote(card({ escrowHeld: true, stageId: "a" }), "project", "p");
	assertEquals(held.stages[0].phase, "funded");
});

Deno.test("the database row maps onto the SSOT, failing closed on an unknown block", () => {
	const quote = ticketFundingQuoteOf({
		project_id: "p-uuid",
		ticket_id: "t-uuid",
		ticket_slug: "tkt-aaaaaaaaaa",
		ticket_title: "Ship it",
		funding_stage_id: "s-a",
		funding_stage_name: "Design",
		amount_cents: "40000",
		currency: "gbp",
		blocked: null,
		stages: [
			{
				stage_id: "s-a",
				name: "Design",
				order: 0,
				stage_status: "open",
				amount_cents: 40000,
				phase: "now",
				fundable: true,
			},
			{
				stage_id: "s-b",
				name: "Build",
				order: 1,
				stage_status: "open",
				amount_cents: null,
				phase: "prepaid",
			},
		],
		engagement: "service",
		ttl_hours: 120,
		payer_scope: "business",
		payer_id: "biz",
		wallet_balance_cents: 1500,
	});
	assertEquals([quote.amount.currency, quote.amount.minor, quote.escrowTtlHours], [
		"GBP",
		40_000,
		120,
	]);
	assertEquals(quote.stages[1].amount, null);
	assertEquals(quote.stages.map((s) => [s.phase, s.fundable]), [["now", true], ["prepaid", false]]);
	assertEquals(quote.payer, { scope: "business", id: "biz" });
	assertEquals(ticketFundingQuoteOf({ blocked: "something_new", stages: [] }).blocked, "finished");
	assertEquals(ticketFundingQuoteOf({ ttl_hours: 0, engagement: "project" }).escrowTtlHours, 168);
});
