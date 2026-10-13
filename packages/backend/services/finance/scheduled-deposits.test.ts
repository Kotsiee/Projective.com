import { assertEquals } from "@std/assert";
import type { InboundPayment } from "@projective/types/finance";
import type { Stripe } from "../../core/stripe.ts";
import type { ClaimedDeposit } from "./live-payments.ts";
import {
	chargeScheduledDeposit,
	type DepositChargeDeps,
	isDeterministicRefusal,
} from "./scheduled-deposits.ts";
import { createOffSessionPaymentIntent } from "./stripe-rails.ts";

const PAYMENT = {
	id: "7c0f4a52-5d0e-4b8e-9f43-1a2b3c4d5e6f",
	purpose: "wallet_topup",
	walletId: "9bc97e73-5ac6-487a-a2a7-1d156c8ac784",
	projectStageId: null,
	amountCents: 2000,
	currency: "USD",
	amountReceivedCents: null,
	status: "requires_payment",
	lockStatus: "not_applicable",
	lockError: null,
	lockedEscrowIds: [],
	provider: "stripe",
	providerRef: null,
	idempotencyKey: "deposit:rule:20261013120000",
	transactionId: null,
	failureReason: null,
	livemode: null,
	createdBy: "de29f2ce-0f36-4db5-a417-4edc88cedf83",
	createdAt: "2026-10-13T12:00:00Z",
	updatedAt: "2026-10-13T12:00:00Z",
	succeededAt: null,
} as unknown as InboundPayment;

const run = (retry: boolean): ClaimedDeposit => ({
	payment: PAYMENT,
	ruleId: "0f1e2d3c-4b5a-4968-8776-655443322110",
	customerRef: "cus_test",
	paymentMethodRef: "pm_test",
	retry,
});

/** A Stripe error shaped the way the SDK throws it (keyed on `type`, as classifyStripeError reads it). */
const stripeError = (type: string, code: string | null, raw: Record<string, unknown> = {}) =>
	Object.assign(new Error(`${type} ${code ?? ""}`), { type, code, raw });

/** Fake doors that record every call. */
function fakes(createIntent: DepositChargeDeps["createIntent"]) {
	const binds: Array<[string, string | null, string | null]> = [];
	const reports: string[] = [];
	const deps: DepositChargeDeps = {
		createIntent,
		bind: (paymentId, providerRef, error) => {
			binds.push([paymentId, providerRef, error]);
			return Promise.resolve({});
		},
		report: (_id, kind) => reports.push(kind),
	};
	return { deps, binds, reports };
}

Deno.test("a charged run is bound to its intent", async () => {
	const { deps, binds } = fakes(() => Promise.resolve({ id: "pi_1" }));
	assertEquals(await chargeScheduledDeposit(run(false), deps), "charged");
	assertEquals(binds, [[PAYMENT.id, "pi_1", null]]);
});

Deno.test("a transient Stripe failure leaves the run unbound for the next sweep — no strike, no failure", async () => {
	for (
		const error of [
			stripeError("StripeConnectionError", null),
			stripeError("StripeAPIError", null),
			stripeError("StripeRateLimitError", "rate_limit"),
			new TypeError("fetch failed"),
		]
	) {
		const { deps, binds, reports } = fakes(() => Promise.reject(error));
		assertEquals(await chargeScheduledDeposit(run(false), deps), "pending");
		assertEquals(binds, [], "a transient failure must not be recorded against the run or the rule");
		assertEquals(reports.length, 1);
	}
});

Deno.test("the retried run is re-sent and bound exactly like a first attempt", async () => {
	const seen: ClaimedDeposit[] = [];
	const { deps, binds } = fakes((r) => {
		seen.push(r);
		return Promise.resolve({ id: "pi_same" });
	});
	assertEquals(await chargeScheduledDeposit(run(true), deps), "charged");
	assertEquals(seen[0].payment.id, PAYMENT.id);
	assertEquals(binds, [[PAYMENT.id, "pi_same", null]]);
});

Deno.test("a declined card or a required authentication is still a strike against the rule", async () => {
	for (const code of ["card_declined", "authentication_required"]) {
		const { deps, binds } = fakes(() =>
			Promise.reject(stripeError("StripeCardError", code, { payment_intent: { id: "pi_refused" } }))
		);
		assertEquals(await chargeScheduledDeposit(run(false), deps), "refused");
		assertEquals(binds, [[PAYMENT.id, "pi_refused", code]]);
	}
});

Deno.test("an idempotency conflict (the same key still in flight) is transient, never a strike", async () => {
	assertEquals(
		isDeterministicRefusal(stripeError("StripeIdempotencyError", "idempotency_key_in_use")),
		false,
	);
	const { deps, binds } = fakes(() => Promise.reject(stripeError("StripeIdempotencyError", null)));
	assertEquals(await chargeScheduledDeposit(run(true), deps), "pending");
	assertEquals(binds, []);
});

Deno.test("an intent made but not recorded is left pending, so the next sweep binds the same intent", async () => {
	const { deps, reports } = fakes(() => Promise.resolve({ id: "pi_1" }));
	deps.bind = () => Promise.reject(new Error("database unreachable"));
	assertEquals(await chargeScheduledDeposit(run(false), deps), "pending");
	assertEquals(reports, ["bind"]);
});

Deno.test("every attempt at a run is sent under the same idempotency key and the same request", async () => {
	const calls: Array<{ params: Record<string, unknown>; key: string | undefined }> = [];
	const stripe = {
		paymentIntents: {
			create: (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
				calls.push({ params, key: options?.idempotencyKey });
				return Promise.resolve({ id: "pi_same", client_secret: null, status: "processing" });
			},
		},
	} as unknown as Stripe;
	await createOffSessionPaymentIntent(stripe, PAYMENT, "cus_test", "pm_test");
	await createOffSessionPaymentIntent(stripe, PAYMENT, "cus_test", "pm_test");
	assertEquals(calls.length, 2);
	assertEquals(calls[0].key, `projective:scheduled_deposit:${PAYMENT.id}`);
	assertEquals(calls[1].key, calls[0].key);
	assertEquals(calls[1].params, calls[0].params);
	assertEquals(calls[0].params.off_session, true);
});
