import { assert, assertEquals } from "@std/assert";
import {
	CardPaymentHandoffSchema,
	ConnectOnboardingInputSchema,
	CreateEscrowLockIntentSchema,
	isHandledStripeEvent,
	PayoutAccountScopeSchema,
	payoutAccountStatusFor,
} from "./payments.ts";

const UUID = "de29f2ce-0f36-4db5-a417-4edc88cedf83";

Deno.test("payoutAccountStatusFor: only an ACTIVE transfers capability makes an account payable", () => {
	assertEquals(payoutAccountStatusFor("active"), "verified");
	assertEquals(payoutAccountStatusFor("pending"), "pending_verification");
	assertEquals(payoutAccountStatusFor("restricted"), "restricted");
	assertEquals(payoutAccountStatusFor("unsupported"), "disabled");
	// A just-created account reports no capability yet: pending, never verified.
	assertEquals(payoutAccountStatusFor(null), "pending_verification");
});

Deno.test("isHandledStripeEvent: the four named events plus their failure halves, nothing else", () => {
	for (
		const type of [
			"payment_intent.succeeded",
			"identity.verification_session.verified",
			"transfer.created",
			"charge.dispute.created",
			"payment_intent.payment_failed",
			"payment_intent.canceled",
			"identity.verification_session.requires_input",
			"identity.verification_session.canceled",
		]
	) {
		assert(isHandledStripeEvent(type), type);
	}
	assert(!isHandledStripeEvent("charge.succeeded"));
	assert(!isHandledStripeEvent("payment_intent.created"));
	assert(!isHandledStripeEvent(""));
});

Deno.test("a team request must name its team; a personal one need not", () => {
	assert(PayoutAccountScopeSchema.safeParse({ scope: "personal", teamId: null }).success);
	const team = PayoutAccountScopeSchema.safeParse({ scope: "team", teamId: null });
	assert(!team.success);
	assertEquals(team.error.issues[0].path, ["teamId"]);
	assert(PayoutAccountScopeSchema.safeParse({ scope: "team", teamId: UUID }).success);
});

Deno.test("Connect onboarding needs an ISO alpha-2 country, because Stripe fixes it at creation", () => {
	assert(ConnectOnboardingInputSchema.safeParse({ scope: "personal", country: "GB" }).success);
	assert(ConnectOnboardingInputSchema.safeParse({ scope: "personal", country: "gb" }).success);
	assert(
		!ConnectOnboardingInputSchema.safeParse({ scope: "personal", country: "United Kingdom" })
			.success,
	);
	assert(!ConnectOnboardingInputSchema.safeParse({ scope: "personal" }).success);
});

Deno.test("an escrow-lock request carries what was shown, and an attempt key of 8-120 characters", () => {
	const base = { projectId: UUID, stageId: UUID, expectedAmountMinor: 3200000, currency: "USD" };
	assert(
		CreateEscrowLockIntentSchema.safeParse({ ...base, idempotencyKey: "attempt-0001" }).success,
	);
	assert(!CreateEscrowLockIntentSchema.safeParse({ ...base, idempotencyKey: "short" }).success);
	assert(
		!CreateEscrowLockIntentSchema.safeParse({
			...base,
			expectedAmountMinor: 0,
			idempotencyKey: "attempt-0001",
		}).success,
	);
	assert(
		!CreateEscrowLockIntentSchema.safeParse({
			...base,
			expectedAmountMinor: 1.5,
			idempotencyKey: "attempt-0001",
		}).success,
	);
});

Deno.test("a handoff only ever carries a PaymentIntent id, never another Stripe object", () => {
	const handoff = {
		paymentId: UUID,
		purpose: "escrow_lock",
		status: "requires_payment",
		lockStatus: "pending",
		amount: { minor: 3200000, currency: "USD", display: "$32,000.00", origin: null },
		providerRef: "pi_3Pqexample",
		clientSecret: "pi_3Pqexample_secret_abc",
		publishableKey: null,
		mode: "test",
		replayed: false,
	};
	assert(CardPaymentHandoffSchema.safeParse(handoff).success);
	assert(!CardPaymentHandoffSchema.safeParse({ ...handoff, providerRef: "ch_3Pqexample" }).success);
	assert(!CardPaymentHandoffSchema.safeParse({ ...handoff, clientSecret: "" }).success);
});
