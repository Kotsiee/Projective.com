import { assertEquals } from "@std/assert";
import type { Stripe } from "../../core/stripe.ts";
import type { UnsettledCardPayment } from "./live-payments.ts";
import { type CardSweepDeps, sweepCardPayment } from "./PaymentBackendService.ts";
import { planCardSweep, STALE_INTENT_MS, type SweptIntent } from "./stripe-rails.ts";

/**
 * The card-payment recovery sweep (FINANCE_COMPLETENESS_AUDIT N1, FINANCE_AUDIT CO15): a succeeded
 * intent is settled through the webhook's door, and an intent still waiting on its payer 24 hours after
 * it was created is canceled at Stripe — re-read first, under a key derived from the intent, so a sweep
 * run twice cancels once. Run against a fake Stripe client; no key, no network.
 */

// #region Fixtures
const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

interface FakeIntent {
	id: string;
	status: string;
	/** Unix seconds, as Stripe sends it. */
	created: number;
	amount_received: number;
	currency: string;
	livemode: boolean;
	metadata: Record<string, string>;
}

/** An intent for `paymentId`, created `hoursAgo` before {@link NOW}. */
function intent(id: string, paymentId: string, status: string, hoursAgo: number): FakeIntent {
	return {
		id,
		status,
		created: Math.floor((NOW - hoursAgo * HOUR) / 1000),
		amount_received: status === "succeeded" ? 4_000 : 0,
		currency: "gbp",
		livemode: false,
		metadata: { projective_payment_id: paymentId },
	};
}

/**
 * A fake Stripe client over `intents`, recording every cancel. `onRetrieve` may move an intent between
 * reads — the payer coming back between the sweep's look and its cancel.
 */
function fakeStripe(
	intents: FakeIntent[],
	onRetrieve?: (intent: FakeIntent, reads: number) => void,
) {
	const byId = new Map(intents.map((pi) => [pi.id, { ...pi }]));
	const cancels: { id: string; reason?: string; key?: string }[] = [];
	let reads = 0;
	const stripe = {
		paymentIntents: {
			retrieve: (id: string) => {
				const found = byId.get(id);
				if (!found) return Promise.reject(new Error(`no such intent ${id}`));
				onRetrieve?.(found, ++reads);
				return Promise.resolve({ ...found });
			},
			search: ({ query }: { query: string }) =>
				Promise.resolve({
					data: [...byId.values()].filter((pi) =>
						query.includes(`'${pi.metadata.projective_payment_id}'`)
					),
				}),
			cancel: (
				id: string,
				params: { cancellation_reason?: string },
				options: { idempotencyKey?: string },
			) => {
				cancels.push({ id, reason: params.cancellation_reason, key: options.idempotencyKey });
				const found = byId.get(id)!;
				found.status = "canceled";
				return Promise.resolve({ ...found });
			},
		},
	} as unknown as Stripe;
	return { stripe, cancels };
}

function payment(paymentId: string, providerRef: string | null): UnsettledCardPayment {
	return { paymentId, providerRef, amountCents: 4_000, currency: "GBP" };
}

/** The settle door as a spy, at a fixed clock. */
function depsWith(settled: string[]): CardSweepDeps {
	return {
		settle: (args) => {
			settled.push(args.eventId);
			return Promise.resolve({
				outcome: "applied",
				detail: null,
				raw: { transaction_id: "tx-sweep" },
			});
		},
		now: () => NOW,
	};
}

const PAY_STALE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PAY_PAID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
// #endregion

Deno.test("the sweep cancels an intent still unpaid 25 hours on, and leaves a succeeded one to settle", async () => {
	const settled: string[] = [];
	const { stripe, cancels } = fakeStripe([
		intent("pi_stale", PAY_STALE, "requires_payment_method", 25),
		intent("pi_paid", PAY_PAID, "succeeded", 25),
	]);
	const stale = await sweepCardPayment(stripe, payment(PAY_STALE, "pi_stale"), depsWith(settled));
	const paid = await sweepCardPayment(stripe, payment(PAY_PAID, "pi_paid"), depsWith(settled));

	assertEquals([stale.outcome, stale.paymentIntent], ["canceled", "pi_stale"]);
	assertEquals(cancels, [{
		id: "pi_stale",
		reason: "abandoned",
		key: "projective:cancel_stale_intent:pi_stale",
	}]);
	assertEquals([paid.outcome, paid.paymentIntent], ["settled", "pi_paid"]);
	assertEquals(settled, ["evt_sweep_pi_paid"]);
});

Deno.test("a younger intent, a processing one and an authorised one are left for the next sweep", async () => {
	for (
		const [status, hoursAgo] of [["requires_action", 23], ["processing", 30], [
			"requires_capture",
			30,
		]] as const
	) {
		const { stripe, cancels } = fakeStripe([intent("pi_x", PAY_STALE, status, hoursAgo)]);
		const result = await sweepCardPayment(stripe, payment(PAY_STALE, "pi_x"), depsWith([]));
		assertEquals([status, result.outcome, cancels.length], [status, "unpaid", 0]);
	}
});

Deno.test("the intent is re-read before it is canceled: one the payer came back to is left alone", async () => {
	// The sweep's look finds it waiting; by the cancel's re-read the bank has answered.
	const { stripe, cancels } = fakeStripe(
		[intent("pi_back", PAY_STALE, "requires_action", 26)],
		(found, reads) => {
			if (reads === 2) found.status = "processing";
		},
	);
	const result = await sweepCardPayment(stripe, payment(PAY_STALE, "pi_back"), depsWith([]));
	assertEquals([result.outcome, result.detail, cancels.length], [
		"unpaid",
		"left as processing",
		0,
	]);
});

Deno.test("a sweep run twice cancels once", async () => {
	const { stripe, cancels } = fakeStripe([
		intent("pi_stale", PAY_STALE, "requires_confirmation", 48),
	]);
	const first = await sweepCardPayment(stripe, payment(PAY_STALE, "pi_stale"), depsWith([]));
	const second = await sweepCardPayment(stripe, payment(PAY_STALE, "pi_stale"), depsWith([]));
	assertEquals([first.outcome, second.outcome, cancels.length], ["canceled", "unpaid", 1]);
});

Deno.test("an unbound payment's intent is found by its projective_payment_id", async () => {
	const { stripe, cancels } = fakeStripe([
		intent("pi_lost_bind", PAY_STALE, "requires_payment_method", 25),
	]);
	const result = await sweepCardPayment(stripe, payment(PAY_STALE, null), depsWith([]));
	assertEquals([result.outcome, cancels.map((c) => c.id)], ["canceled", ["pi_lost_bind"]]);
});

Deno.test("planCardSweep: a succeeded intent is settled before any stale one is canceled; 24 hours is the line", () => {
	const swept = (id: string, status: string, ageMs: number): SweptIntent => ({
		id,
		status,
		createdMs: NOW - ageMs,
		amountReceived: 0,
		currency: "GBP",
		livemode: false,
	});
	const stale = swept("pi_stale", "requires_payment_method", STALE_INTENT_MS + 1);
	const paid = swept("pi_paid", "succeeded", HOUR);
	assertEquals(planCardSweep([stale, paid], NOW), { kind: "settle", intent: paid });
	assertEquals(planCardSweep([stale], NOW), { kind: "cancel", intent: stale });
	assertEquals(planCardSweep([swept("pi_day", "requires_payment_method", STALE_INTENT_MS)], NOW), {
		kind: "wait",
	});
	assertEquals(planCardSweep([], NOW), { kind: "wait" });
});
