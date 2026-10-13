import { assertEquals, assertThrows } from "@std/assert";
import type { Stripe } from "../../core/stripe.ts";
import type { EventOutcome } from "./live-payments.ts";
import { planStripeEvent, requireLedgerRow } from "./stripe-webhook.ts";

/** A minimal event of a given type around a data object — the fields the planner reads, no more. */
function event(type: string, object: Record<string, unknown>): Stripe.Event {
	return {
		id: "evt_test_1",
		object: "event",
		type,
		livemode: false,
		created: 0,
		api_version: "2026-08-26.dahlia",
		pending_webhooks: 0,
		request: { id: null, idempotency_key: null },
		data: { object },
	} as unknown as Stripe.Event;
}

Deno.test("payment_intent.succeeded settles what was RECEIVED, in upper-case currency", () => {
	assertEquals(
		planStripeEvent(event("payment_intent.succeeded", {
			id: "pi_1",
			amount: 5000,
			amount_received: 4900,
			currency: "usd",
			metadata: { projective_payment_id: "6f1f0d7e-2b0a-4c1e-9d6a-3b8e5f2a1c90" },
		})),
		{ kind: "payment_succeeded", paymentIntent: "pi_1", amountReceived: 4900, currency: "USD" },
	);
});

Deno.test("a succeeded intent Projective did not create is acknowledged as ignored, never retried", () => {
	const base = { id: "pi_1", amount: 5000, amount_received: 5000, currency: "usd" };
	assertEquals(planStripeEvent(event("payment_intent.succeeded", base)).kind, "ignore");
	assertEquals(
		planStripeEvent(
			event("payment_intent.succeeded", { ...base, metadata: { projective_payment_id: "nope" } }),
		).kind,
		"ignore",
	);
});

const outcome = (over: Partial<EventOutcome>): EventOutcome => ({
	outcome: "applied",
	detail: null,
	raw: {},
	...over,
});

Deno.test("a settlement is acknowledged only with the ledger row it produced (Decision #200)", () => {
	const tx = "0b5c8a1e-7f2d-4e3a-9c6b-1d2e3f4a5b6c";
	const applied = outcome({
		raw: { outcome: "applied", transaction_id: tx, status: "settled_unapplied" },
	});
	assertEquals(requireLedgerRow(applied), applied);
	const replayed = outcome({
		outcome: "replayed",
		raw: { outcome: "replayed", transaction_id: tx },
	});
	assertEquals(requireLedgerRow(replayed), replayed);
});

Deno.test("a settlement without a ledger row throws, so the webhook answers 5xx and Stripe retries", () => {
	// Not bound yet (an off-session deposit's success beat its bind), or the amount / currency differ.
	assertThrows(() =>
		requireLedgerRow(
			outcome({
				outcome: "unmatched",
				detail: "no inbound payment is bound to this PaymentIntent yet",
				raw: { transaction_id: null },
			}),
		)
	);
	// A replay whose first delivery left no ledger row is not an acknowledgement either.
	assertThrows(() =>
		requireLedgerRow(outcome({ outcome: "replayed", raw: { first: { outcome: "unmatched" } } }))
	);
	assertThrows(() =>
		requireLedgerRow(outcome({ outcome: "applied", raw: { transaction_id: "" } }))
	);
	assertThrows(() =>
		requireLedgerRow(outcome({ outcome: "ignored", raw: { transaction_id: "x" } }))
	);
});

Deno.test("a succeeded intent missing its amount is ignored, never half-applied", () => {
	const plan = planStripeEvent(event("payment_intent.succeeded", { id: "pi_1", currency: "usd" }));
	assertEquals(plan.kind, "ignore");
});

Deno.test("a failed payment carries the decline CODE, not the processor's prose", () => {
	assertEquals(
		planStripeEvent(event("payment_intent.payment_failed", {
			id: "pi_1",
			last_payment_error: {
				code: "card_declined",
				decline_code: "insufficient_funds",
				message: "Your card has insufficient funds.",
			},
		})),
		{
			kind: "payment_failed",
			paymentIntent: "pi_1",
			status: "failed",
			reason: "insufficient_funds",
		},
	);
	assertEquals(
		planStripeEvent(
			event("payment_intent.canceled", { id: "pi_1", cancellation_reason: "abandoned" }),
		),
		{ kind: "payment_failed", paymentIntent: "pi_1", status: "canceled", reason: "abandoned" },
	);
});

Deno.test("identity events carry only the session id and an error CODE — never extracted data", () => {
	assertEquals(
		planStripeEvent(event("identity.verification_session.verified", {
			id: "vs_1",
			last_error: null,
			verified_outputs: { first_name: "must never be read", dob: { day: 1, month: 1, year: 1990 } },
		})),
		{
			kind: "identity",
			eventType: "identity.verification_session.verified",
			session: "vs_1",
			errorCode: null,
		},
	);
	assertEquals(
		planStripeEvent(event("identity.verification_session.requires_input", {
			id: "vs_1",
			last_error: {
				code: "selfie_face_mismatch",
				reason: "The selfie does not match the document.",
			},
		})),
		{
			kind: "identity",
			eventType: "identity.verification_session.requires_input",
			session: "vs_1",
			errorCode: "selfie_face_mismatch",
		},
	);
});

Deno.test("a transfer names its payout only through a well-formed id in its metadata", () => {
	const base = { id: "tr_1", amount: 5000, currency: "gbp", destination: "acct_1" };
	assertEquals(
		planStripeEvent(event("transfer.created", {
			...base,
			metadata: { projective_payout_id: "00000000-0000-4000-8000-00000000abcd" },
		})),
		{
			kind: "transfer_created",
			transfer: "tr_1",
			destination: "acct_1",
			amount: 5000,
			currency: "GBP",
			payoutId: "00000000-0000-4000-8000-00000000abcd",
		},
	);
	const junk = planStripeEvent(
		event("transfer.created", { ...base, metadata: { projective_payout_id: "'; drop table" } }),
	);
	assertEquals(junk.kind === "transfer_created" ? junk.payoutId : "wrong kind", null);
	// An expanded destination object resolves to its id.
	const expanded = planStripeEvent(
		event("transfer.created", { ...base, destination: { id: "acct_2" }, metadata: {} }),
	);
	assertEquals(
		expanded.kind === "transfer_created" ? expanded.destination : "wrong kind",
		"acct_2",
	);
});

Deno.test("a dispute resolves its PaymentIntent whether it arrives as an id or expanded", () => {
	const base = { id: "du_1", amount: 3200000, currency: "usd", reason: "fraudulent" };
	assertEquals(
		planStripeEvent(event("charge.dispute.created", { ...base, payment_intent: "pi_1" })),
		{
			kind: "dispute_created",
			dispute: "du_1",
			paymentIntent: "pi_1",
			amount: 3200000,
			currency: "USD",
			reason: "fraudulent",
		},
	);
	const expanded = planStripeEvent(
		event("charge.dispute.created", { ...base, payment_intent: { id: "pi_2" } }),
	);
	assertEquals(expanded.kind === "dispute_created" ? expanded.paymentIntent : "wrong kind", "pi_2");
	const orphan = planStripeEvent(
		event("charge.dispute.created", { ...base, payment_intent: null }),
	);
	assertEquals(orphan.kind === "dispute_created" ? orphan.paymentIntent : "wrong kind", null);
});

Deno.test("any other event type is planned as ignore", () => {
	assertEquals(planStripeEvent(event("charge.succeeded", { id: "ch_1" })).kind, "ignore");
});

Deno.test("charge.dispute.closed carries the dispute and its final status (Decision #126)", () => {
	assertEquals(
		planStripeEvent(event("charge.dispute.closed", { id: "du_1", status: "lost", amount: 900 })),
		{ kind: "dispute_closed", dispute: "du_1", status: "lost" },
	);
});

Deno.test("account.updated takes only the account id — the state is re-read from Stripe", () => {
	assertEquals(
		planStripeEvent(event("account.updated", {
			id: "acct_1",
			// A snapshot that SAYS payouts are enabled is not believed; only the id is planned.
			payouts_enabled: true,
			charges_enabled: true,
		})),
		{ kind: "account_updated", account: "acct_1" },
	);
});

Deno.test("setup_intent.succeeded saves a card only for a SetupIntent Projective started", () => {
	const ours = planStripeEvent(event("setup_intent.succeeded", {
		id: "seti_1",
		status: "succeeded",
		customer: "cus_1",
		payment_method: { id: "pm_1", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } },
		metadata: { projective_owner_type: "user", projective_owner_id: "u1", projective_created_by: "u1" },
	}));
	assertEquals(ours.kind, "card_saved");
	if (ours.kind === "card_saved") {
		assertEquals(ours.card.paymentMethodId, "pm_1");
		assertEquals(ours.card.last4, "4242");
		assertEquals(ours.card.createdBy, "u1");
	}
	const foreign = planStripeEvent(event("setup_intent.succeeded", {
		id: "seti_2",
		status: "succeeded",
		payment_method: "pm_2",
		metadata: {},
	}));
	assertEquals(foreign.kind, "ignore");
});

/** A Connect event: delivered to the platform's Connect endpoint on behalf of a connected account. */
function connectEvent(
	type: string,
	account: string | null,
	object: Record<string, unknown>,
): Stripe.Event {
	return { ...event(type, object), ...(account ? { account } : {}) } as unknown as Stripe.Event;
}

Deno.test("transfer.reversed carries the CUMULATIVE amount reversed, so a replay credits nothing twice", () => {
	assertEquals(
		planStripeEvent(event("transfer.reversed", {
			id: "tr_1",
			amount: 5000,
			amount_reversed: 2000,
			reversed: false,
			currency: "gbp",
			destination: "acct_1",
			metadata: { projective_payout_id: "00000000-0000-4000-8000-00000000abcd" },
		})),
		{
			kind: "transfer_reversed",
			transfer: "tr_1",
			destination: "acct_1",
			amount: 5000,
			amountReversed: 2000,
			currency: "GBP",
			payoutId: "00000000-0000-4000-8000-00000000abcd",
		},
	);
	const unreadable = planStripeEvent(
		event("transfer.reversed", { id: "tr_1", amount: 5000, currency: "gbp" }),
	);
	assertEquals(unreadable.kind, "ignore");
});

Deno.test("a connected account's payout.failed carries the account, the payout and the failure CODE", () => {
	assertEquals(
		planStripeEvent(connectEvent("payout.failed", "acct_1", {
			id: "po_1",
			amount: 4000,
			currency: "gbp",
			status: "failed",
			failure_code: "account_closed",
			failure_message: "The bank account has been closed.",
		})),
		{
			kind: "bank_payout",
			eventType: "payout.failed",
			account: "acct_1",
			payout: "po_1",
			status: "failed",
			failureCode: "account_closed",
		},
	);
	assertEquals(
		planStripeEvent(
			connectEvent("payout.paid", "acct_1", {
				id: "po_2",
				amount: 4000,
				currency: "gbp",
				status: "paid",
			}),
		),
		{
			kind: "bank_payout",
			eventType: "payout.paid",
			account: "acct_1",
			payout: "po_2",
			status: "paid",
			failureCode: null,
		},
	);
});

Deno.test("the platform's OWN payout to its bank is not a withdrawal and is ignored", () => {
	const plan = planStripeEvent(
		connectEvent("payout.failed", null, { id: "po_1", amount: 4000, currency: "gbp" }),
	);
	assertEquals(plan.kind, "ignore");
});
