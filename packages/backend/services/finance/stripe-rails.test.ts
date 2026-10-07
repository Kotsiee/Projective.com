import { assert, assertEquals } from "@std/assert";
import { CARD_SETUP_PAYMENT_METHOD_TYPES, type InboundPayment } from "@projective/types/finance";
import {
	classifyStripeError,
	connectAccountParams,
	identitySessionParams,
	onboardingLinkParams,
	paymentIntentParams,
	setupIntentParams,
	transfersCapabilityOf,
} from "./stripe-rails.ts";

const PAYMENT: InboundPayment = {
	id: "b5121fc8-ee24-48ac-ab0f-9d07f0a6748a",
	purpose: "escrow_lock",
	walletId: "9bc97e73-5ac6-487a-a2a7-1d156c8ac784",
	projectStageId: "1df76187-f9b7-4c96-abc4-cd4dc4f456b4",
	amountCents: 3200000,
	currency: "USD",
	amountReceivedCents: null,
	status: "requires_payment",
	lockStatus: "pending",
	lockError: null,
	lockedEscrowIds: [],
	provider: "stripe",
	providerRef: null,
	idempotencyKey: "attempt-0001",
	transactionId: null,
	failureReason: null,
	livemode: null,
	createdBy: "de29f2ce-0f36-4db5-a417-4edc88cedf83",
	createdAt: "2026-09-29T00:00:00Z",
	updatedAt: "2026-09-29T00:00:00Z",
	succeededAt: null,
};

Deno.test("a card payment is a PLATFORM charge: no destination, no fee skim, no hard-coded methods", () => {
	const params = paymentIntentParams(PAYMENT) as unknown as Record<string, unknown>;
	for (
		const forbidden of [
			"transfer_data",
			"on_behalf_of",
			"application_fee_amount",
			"payment_method_types",
		]
	) {
		assert(!(forbidden in params), `${forbidden} must not be set`);
	}
	assertEquals(params.amount, 3200000);
	assertEquals(params.currency, "usd");
	assertEquals(params.transfer_group, `projective_payment_${PAYMENT.id}`);
	assertEquals((params.metadata as Record<string, string>).projective_payment_id, PAYMENT.id);
	assertEquals(
		(params.metadata as Record<string, string>).projective_stage_id,
		PAYMENT.projectStageId,
	);
});

Deno.test("a card SetupIntent is card-only and off-session, matching the deferred card form", () => {
	const params = setupIntentParams("cus_123", {
		ownerType: "team",
		ownerId: PAYMENT.walletId,
		displayName: "North Loop",
		contactEmail: null,
		createdBy: PAYMENT.createdBy,
	}) as unknown as Record<string, unknown>;
	assertEquals(params.customer, "cus_123");
	assertEquals(params.usage, "off_session");
	// The browser mounts Elements with `allowedPaymentMethodTypes: CARD_SETUP_PAYMENT_METHOD_TYPES`
	// before this intent exists; Stripe requires the two to match.
	assertEquals(params.allowed_payment_method_types, [...CARD_SETUP_PAYMENT_METHOD_TYPES]);
	// Mutually exclusive with `allowed_payment_method_types`; `payment_method_types` is being retired.
	for (const forbidden of ["automatic_payment_methods", "payment_method_types"]) {
		assert(!(forbidden in params), `${forbidden} must not be set`);
	}
	assertEquals(params.metadata, {
		projective_owner_type: "team",
		projective_owner_id: PAYMENT.walletId,
		projective_created_by: PAYMENT.createdBy,
	});
});

Deno.test("a top-up names no stage in its metadata", () => {
	const params = paymentIntentParams({
		...PAYMENT,
		purpose: "wallet_topup",
		projectStageId: null,
		lockStatus: "not_applicable",
	});
	assert(!("projective_stage_id" in (params.metadata as Record<string, string>)));
});

Deno.test("a payout account is a v2 Express RECIPIENT with application-held fees and losses", () => {
	const params = connectAccountParams({
		ownerType: "freelancer",
		ownerId: PAYMENT.createdBy,
		displayName: "Juno Park",
		contactEmail: "juno@projective.dev",
		country: "GB",
	}) as unknown as {
		contact_email?: string;
		dashboard: string;
		identity: { country: string };
		configuration: Record<string, unknown>;
		defaults: { responsibilities: { fees_collector: string; losses_collector: string } };
		metadata: Record<string, string>;
		type?: unknown;
	};
	assertEquals(params.dashboard, "express");
	assertEquals(params.identity.country, "gb");
	assertEquals(Object.keys(params.configuration), ["recipient"]);
	assertEquals(params.defaults.responsibilities, {
		fees_collector: "application",
		losses_collector: "application",
	});
	assertEquals(params.metadata.projective_owner_id, PAYMENT.createdBy);
	assert(!("type" in params), "never a v1 account type");
	// Stripe refuses a recipient account with no contact email (`invalid_fields`, found against a
	// real test account on 2026-09-29 — stripe-mock does not serve v2 and accepted nothing to refuse).
	assertEquals(params.contact_email, "juno@projective.dev");
});

Deno.test("a payout account with no address on file omits contact_email rather than sending null", () => {
	const params = connectAccountParams({
		ownerType: "team",
		ownerId: PAYMENT.createdBy,
		displayName: "North Loop",
		contactEmail: null,
		country: "GB",
	}) as unknown as Record<string, unknown>;
	assert(!("contact_email" in params));
});

Deno.test("a verified account gets an UPDATE link; anything else resumes onboarding", () => {
	const urls = {
		refreshUrl: "https://app.test/api/finance/connect/refresh",
		returnUrl: "https://app.test/api/finance/connect/return",
	};
	const update = onboardingLinkParams("acct_1", urls, true) as { use_case: { type: string } };
	const onboard = onboardingLinkParams("acct_1", urls, false) as {
		use_case: {
			type: string;
			account_onboarding: { configurations: string[]; refresh_url: string };
		};
	};
	assertEquals(update.use_case.type, "account_update");
	assertEquals(onboard.use_case.type, "account_onboarding");
	assertEquals(onboard.use_case.account_onboarding.configurations, ["recipient"]);
	assertEquals(onboard.use_case.account_onboarding.refresh_url, urls.refreshUrl);
});

Deno.test("the capability path is read defensively", () => {
	const active = {
		configuration: {
			recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } } },
		},
	};
	assertEquals(transfersCapabilityOf(active), "active");
	assertEquals(transfersCapabilityOf({}), null);
	assertEquals(transfersCapabilityOf(null), null);
	assertEquals(
		transfersCapabilityOf({
			configuration: {
				recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "weird" } } } },
			},
		}),
		null,
	);
});

Deno.test("the identity check is a live-captured document with a matching selfie, keyed by Projective ids", () => {
	const params = identitySessionParams(
		"case-1",
		"user-1",
		"https://app.test/wallet?identity=returned",
	) as unknown as {
		type: string;
		options: { document: { require_live_capture: boolean; require_matching_selfie: boolean } };
		client_reference_id: string;
		metadata: Record<string, string>;
	};
	assertEquals(params.type, "document");
	assertEquals(params.options.document, {
		require_live_capture: true,
		require_matching_selfie: true,
	});
	assertEquals(params.client_reference_id, "case-1");
	assertEquals(params.metadata, { projective_case_id: "case-1", projective_user_id: "user-1" });
});

Deno.test("Stripe failures classify by type: refused vs transient vs misconfigured", () => {
	assertEquals(
		classifyStripeError({ type: "StripeInvalidRequestError", code: "parameter_invalid" }).kind,
		"refused",
	);
	assertEquals(classifyStripeError({ type: "StripeCardError" }).kind, "refused");
	assertEquals(classifyStripeError({ type: "StripeAuthenticationError" }).kind, "misconfigured");
	assertEquals(classifyStripeError({ type: "StripeConnectionError" }).kind, "transient");
	assertEquals(classifyStripeError({ type: "StripeRateLimitError" }).kind, "transient");
	assertEquals(classifyStripeError(new TypeError("fetch failed")).kind, "transient");
});
