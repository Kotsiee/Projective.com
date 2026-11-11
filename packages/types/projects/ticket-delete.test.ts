import { assertEquals } from "@std/assert";
import { type BoardCard, ticketDeletable } from "./board.ts";

type DeleteFacts = Parameters<typeof ticketDeletable>[0];

const pristine = (over: Partial<DeleteFacts> = {}): DeleteFacts => ({
	claimed: false,
	claimedAt: null,
	escrowHeld: false,
	paymentScope: "unpaid",
	payments: [],
	submissions: [],
	status: "backlog",
	frozen: false,
	funding: null,
	...over,
});

const funding = (
	state: NonNullable<BoardCard["funding"]>["state"],
	nextAction: NonNullable<BoardCard["funding"]>["nextAction"],
): BoardCard["funding"] => ({
	state,
	nextAction,
	amountMinor: 45_000,
	currency: "USD",
	amountLabel: "$450.00",
	canStart: false,
	reason: null,
});

Deno.test("a ticket nothing has happened to may be deleted", () => {
	assertEquals(ticketDeletable(pristine()), true);
	assertEquals(ticketDeletable(pristine({ funding: funding("draft", "describe") })), true);
	assertEquals(ticketDeletable(pristine({ funding: funding("needs_funding", "fund") })), true);
});

Deno.test("a claimed, held, paid or submitted-against ticket is archived, never deleted", () => {
	assertEquals(ticketDeletable(pristine({ claimed: true })), false);
	assertEquals(ticketDeletable(pristine({ claimedAt: "2026-11-01T10:00:00Z" })), false);
	assertEquals(ticketDeletable(pristine({ escrowHeld: true })), false);
	assertEquals(ticketDeletable(pristine({ paymentScope: "full" })), false);
	assertEquals(ticketDeletable(pristine({ status: "completed" })), false);
	assertEquals(ticketDeletable(pristine({ frozen: true })), false);
});

Deno.test("a ticket paid ahead or with a purchase in flight is not pristine", () => {
	assertEquals(ticketDeletable(pristine({ funding: funding("draft", "none") })), false);
	assertEquals(
		ticketDeletable(pristine({ funding: funding("processing", "await_payment") })),
		false,
	);
	assertEquals(ticketDeletable(pristine({ funding: funding("funded", "start_work") })), false);
	assertEquals(ticketDeletable(pristine({ funding: funding("failed", "retry_payment") })), false);
});
