import { assertEquals } from "@std/assert";
import { FundingRollupSchema, FundingStatusSchema } from "@projective/types/finance";
import {
	deriveFundingState,
	type FundingEscrowInput,
	type FundingPaymentInput,
	type FundingTicketInput,
	paymentFundingState,
	rollupFundingState,
} from "./funding-state.ts";

// Every transition of PRODUCT_MANAGEMENT.md §3.6, one fact change at a time.

const ticket = (over: Partial<FundingTicketInput> = {}): FundingTicketInput => ({
	status: "backlog",
	paymentStatus: "unpaid",
	hasDescription: true,
	amountMinor: 45_000,
	currency: "usd",
	...over,
});
const escrow = (status: string): FundingEscrowInput => ({ status, amountMinor: 45_000, currency: "USD" });
const payment = (over: Partial<FundingPaymentInput> = {}): FundingPaymentInput => ({
	status: "processing",
	lockStatus: "pending",
	lockError: null,
	failureReason: null,
	...over,
});
const stateOf = (...args: Parameters<typeof deriveFundingState>) => deriveFundingState(...args).state;

Deno.test("Draft: the next act is to describe, price or fund the ticket", () => {
	assertEquals(deriveFundingState(ticket({ hasDescription: false })).nextAction, "describe");
	assertEquals(deriveFundingState(ticket({ amountMinor: null })).nextAction, "set_price");
	assertEquals(deriveFundingState(ticket({ amountMinor: 0 })).nextAction, "set_price");
	const draft = deriveFundingState(ticket());
	assertEquals([draft.state, draft.nextAction, draft.canStart], ["draft", "fund", false]);
	assertEquals([draft.amountMinor, draft.currency, draft.amountLabel], [45_000, "USD", "US$450.00"]);
	FundingStatusSchema.parse(draft);
});

Deno.test("Draft → Funded: the lock trigger fired and the hold was made", () => {
	const funded = deriveFundingState(ticket({ status: "claimed", paymentStatus: "escrow_funded" }));
	assertEquals([funded.state, funded.canStart, funded.nextAction], ["funded", true, "start_work"]);
	assertEquals(stateOf(ticket({ status: "todo" }), escrow("held")), "funded");
});

Deno.test("Draft → Needs funding: the hold was refused", () => {
	const nf = deriveFundingState(ticket({ paymentStatus: "needs_funding" }));
	assertEquals([nf.state, nf.nextAction, nf.canStart], ["needs_funding", "fund", false]);
	assertEquals(deriveFundingState(ticket({ paymentStatus: "needs_funding", amountMinor: null })).nextAction, "set_price");
});

Deno.test("Needs funding → Funded (wallet hold) and → Payment processing (card Buy Now)", () => {
	assertEquals(stateOf(ticket({ status: "claimed", paymentStatus: "needs_funding" }), escrow("held")), "funded");
	const processing = deriveFundingState(ticket({ paymentStatus: "needs_funding" }), null, payment());
	assertEquals([processing.state, processing.nextAction], ["processing", "await_payment"]);
	assertEquals(stateOf(ticket(), null, payment({ status: "requires_payment" })), "processing");
});

Deno.test("Payment processing → Funded once the webhook settled and the lock held", () => {
	const settled = payment({ status: "succeeded", lockStatus: "locked" });
	assertEquals(stateOf(ticket({ status: "claimed", paymentStatus: "escrow_funded" }), null, settled), "funded");
	assertEquals(stateOf(ticket(), null, payment({ status: "succeeded", lockStatus: "pending" })), "processing");
});

Deno.test("Payment processing → Failed: the card failed, or the lock was refused after settling", () => {
	const declined = deriveFundingState(ticket(), null, payment({ status: "failed", failureReason: "Card declined" }));
	assertEquals([declined.state, declined.nextAction, declined.reason], ["failed", "retry_payment", "Card declined"]);
	const lockFailed = deriveFundingState(
		ticket(),
		null,
		payment({ status: "succeeded", lockStatus: "failed", lockError: "Less arrived than the stage needs." }),
	);
	assertEquals([lockFailed.state, lockFailed.reason], ["failed", "Less arrived than the stage needs."]);
});

Deno.test("Payment processing → Needs funding when the payer abandons", () => {
	assertEquals(stateOf(ticket({ paymentStatus: "needs_funding" }), null, payment({ status: "canceled" })), "needs_funding");
	assertEquals(stateOf(ticket(), null, payment({ status: "canceled" })), "draft");
});

Deno.test("Failed → Payment processing (retry) and → Funded (wallet hold)", () => {
	assertEquals(stateOf(ticket(), null, payment({ status: "processing" })), "processing");
	assertEquals(stateOf(ticket({ status: "claimed" }), escrow("held"), payment({ status: "failed" })), "funded");
});

Deno.test("Funded → In progress → In review ⇄ In progress → Released", () => {
	const held = { paymentStatus: "escrow_funded" };
	const working = deriveFundingState(ticket({ ...held, status: "in_progress" }));
	assertEquals([working.state, working.nextAction, working.canStart], ["in_progress", "submit", false]);
	assertEquals(deriveFundingState(ticket({ ...held, status: "in_review" })).nextAction, "review");
	assertEquals(stateOf(ticket({ status: "in_progress" }), escrow("held")), "in_progress");
	assertEquals(stateOf(ticket({ status: "completed", paymentStatus: "released" })), "released");
	assertEquals(stateOf(ticket({ status: "completed" }), escrow("released")), "released");
	// A disputed escrow is still held — the dispute is a fund state, not a funding state.
	assertEquals(stateOf(ticket({ status: "in_review" }), escrow("disputed")), "in_review");
});

Deno.test("→ Refunded is terminal per escrow; a re-pooled ticket reads Draft again", () => {
	assertEquals(stateOf(ticket({ status: "cancelled", paymentStatus: "refunded" })), "refunded");
	assertEquals(stateOf(ticket({ status: "cancelled" }), escrow("refunded")), "refunded");
	// fn_release_expired_claims refunds, clears the assignee and resets the ticket to backlog / unpaid.
	assertEquals(stateOf(ticket({ status: "backlog" }), escrow("refunded")), "draft");
});

Deno.test("Work without a held escrow (predates the gate) needs funding", () => {
	assertEquals(stateOf(ticket({ status: "in_progress" })), "needs_funding");
	assertEquals(stateOf(ticket({ status: "claimed", paymentStatus: "partially_released" })), "needs_funding");
	assertEquals(deriveFundingState(ticket({ status: "cancelled" })).nextAction, "none");
});

Deno.test("rollupFundingState leads with the most urgent state and sums its tickets", () => {
	assertEquals(rollupFundingState([]), null);
	const rollup = rollupFundingState([
		deriveFundingState(ticket({ status: "in_progress", paymentStatus: "escrow_funded" })),
		deriveFundingState(ticket({ paymentStatus: "needs_funding", amountMinor: 10_000 })),
		deriveFundingState(ticket({ paymentStatus: "needs_funding", amountMinor: 5_000 })),
		deriveFundingState(ticket({ paymentStatus: "needs_funding", amountMinor: null })),
	]);
	assertEquals(rollup && [rollup.state, rollup.tickets, rollup.amountMinor, rollup.amountLabel], [
		"needs_funding",
		3,
		15_000,
		"US$150.00",
	]);
	FundingRollupSchema.parse(rollup);
	assertEquals(rollupFundingState([deriveFundingState(ticket({ amountMinor: null }))])?.amountMinor, null);
});

Deno.test("paymentFundingState: the poll's answer from the payment alone", () => {
	const p = (over: Partial<FundingPaymentInput>) => ({
		...payment(over),
		amountCents: 45_000,
		currency: "GBP",
	});
	assertEquals(paymentFundingState(p({ status: "requires_payment" })).state, "processing");
	assertEquals(paymentFundingState(p({ status: "succeeded", lockStatus: "pending" })).state, "processing");
	const funded = paymentFundingState(p({ status: "succeeded", lockStatus: "locked" }));
	assertEquals([funded.state, funded.canStart, funded.amountMinor, funded.currency], ["funded", true, 45_000, "GBP"]);
	assertEquals(paymentFundingState(p({ status: "failed" })).state, "failed");
	assertEquals(paymentFundingState(p({ status: "succeeded", lockStatus: "failed" })).state, "failed");
	// Decision #200: a lock refused after the credit settles as settled_unapplied — the same Failed state.
	const unapplied = paymentFundingState(
		p({ status: "settled_unapplied", lockStatus: "failed", lockError: "The stage moved on." }),
	);
	assertEquals(
		[unapplied.state, unapplied.nextAction, unapplied.reason],
		["failed", "retry_payment", "The stage moved on."],
	);
	assertEquals(paymentFundingState(p({ status: "canceled", lockStatus: "failed" })).state, "needs_funding");
});

Deno.test("Funded, paid ahead of any claim: the prepaid escrow is held and the claim binds it (#197)", () => {
	const ahead = deriveFundingState(ticket({ paidAhead: true }));
	assertEquals([ahead.state, ahead.nextAction, ahead.canStart], ["funded", "start_work", true]);
	// Live reads carry no flag: a prepaid ticket is simply `escrow_funded` with nobody on it.
	assertEquals(stateOf(ticket({ status: "todo", paymentStatus: "escrow_funded" })), "funded");
	// The money is held, so a claim never re-asks for it.
	assertEquals(stateOf(ticket({ paidAhead: true, status: "claimed", paymentStatus: "escrow_funded" })), "funded");
});
