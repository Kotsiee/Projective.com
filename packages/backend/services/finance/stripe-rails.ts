import type {
	InboundPayment,
	PayoutAccount,
	TransfersCapabilityStatus,
} from "@projective/types/finance";
import { type Stripe, stripeIdempotencyKey } from "../../core/stripe.ts";

/**
 * stripe-rails — every call this platform makes TO Stripe, as a pure request builder plus a thin call
 * on an injected client.
 *
 * The builders are pure so the request shape is testable without a network, and the calls take the
 * client as an argument so the SAME code can be pointed at `stripe-mock` (which validates every
 * request against Stripe's OpenAPI spec) without a second implementation or a widened environment
 * contract. Nothing here touches the database; `PaymentBackendService` orders the two.
 *
 * Three Stripe rules this module encodes (see `.agents/skills/stripe-best-practices`):
 *
 * - **No `payment_method_types`.** Omitting it enables dynamic payment methods, configured in the
 *   Dashboard rather than hard-coded here.
 * - **Accounts v2, never `type: 'express'`.** An "Express" account is the v2 `dashboard: 'express'`
 *   with the RECIPIENT configuration (it receives transfers; the platform is merchant of record) and
 *   application-held fees and losses — the only combination Stripe accepts for an Express dashboard.
 * - **Every creating call carries an `Idempotency-Key`**, derived from the Projective row it serves,
 *   so a retry can never create a second object for one attempt.
 */

// #region Failure classification
/**
 * How a Stripe failure should be answered:
 * - `transient` — network, 5xx, rate limit: safe to retry under the same key; nothing is abandoned.
 * - `refused` — Stripe rejected THIS request (invalid parameters, an unsupported country or
 *   currency, a card error): retrying the same request cannot succeed, so the attempt is closed.
 * - `misconfigured` — the platform's key or Stripe account is wrong: no user can fix it; logged.
 */
export type StripeFailureKind = "transient" | "refused" | "misconfigured";

/** A classified Stripe failure. `message` is Stripe's own, for the log — never shown verbatim. */
export interface StripeFailure {
	kind: StripeFailureKind;
	code: string | null;
	message: string;
}

/**
 * Classify anything a Stripe call threw. Keyed on the error's `type` string rather than `instanceof`,
 * so it holds across duplicated module instances (a bundler can load the SDK twice).
 */
export function classifyStripeError(error: unknown): StripeFailure {
	const e = (error ?? {}) as { type?: unknown; code?: unknown; message?: unknown };
	const type = typeof e.type === "string" ? e.type : "";
	const code = typeof e.code === "string" ? e.code : null;
	const message = typeof e.message === "string" ? e.message : String(error);
	switch (type) {
		case "StripeInvalidRequestError":
		case "StripeCardError":
		case "StripeIdempotencyError":
			return { kind: "refused", code, message };
		case "StripeAuthenticationError":
		case "StripePermissionError":
			return { kind: "misconfigured", code, message };
		default:
			return { kind: "transient", code, message };
	}
}
// #endregion

// #region PaymentIntents (money in)
type PaymentIntentCreateParams = Parameters<Stripe["paymentIntents"]["create"]>[0];

/** What the browser needs back from a PaymentIntent, and nothing more. */
export interface IntentHandle {
	id: string;
	clientSecret: string | null;
	status: string;
}

/**
 * The PaymentIntent for one inbound payment. Charged on the PLATFORM account — no `transfer_data`, no
 * `on_behalf_of`, no `application_fee_amount` — so the money stays in the platform balance until the
 * ledger releases it, and `transfer_group` ties the eventual payout transfers back to this charge
 * (Separate Charges & Transfers, Decision #125). The metadata carries only Projective ids.
 */
export function paymentIntentParams(payment: InboundPayment): PaymentIntentCreateParams {
	return {
		amount: payment.amountCents,
		currency: payment.currency.toLowerCase(),
		description: payment.purpose === "escrow_lock"
			? "Projective escrow — stage funding"
			: "Projective wallet top-up",
		transfer_group: `projective_payment_${payment.id}`,
		metadata: {
			projective_payment_id: payment.id,
			projective_purpose: payment.purpose,
			projective_wallet_id: payment.walletId,
			...(payment.projectStageId ? { projective_stage_id: payment.projectStageId } : {}),
		},
	};
}

/** Create the PaymentIntent for a started payment. Idempotent on the payment's own id. */
export async function createPaymentIntent(
	stripe: Stripe,
	payment: InboundPayment,
): Promise<IntentHandle> {
	const intent = await stripe.paymentIntents.create(paymentIntentParams(payment), {
		idempotencyKey: stripeIdempotencyKey("payment_intent", payment.id),
	});
	return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
}

/** The Customer a saved PaymentMethod is attached to — `null` when it is attached to none. */
export async function customerOfPaymentMethod(stripe: Stripe, paymentMethodId: string): Promise<string | null> {
	const method = await stripe.paymentMethods.retrieve(paymentMethodId);
	const customer = method.customer;
	return typeof customer === "string" ? customer : customer?.id ?? null;
}

/**
 * Charge a SAVED card for a started payment while its holder is on the page. Confirmed server-side, so
 * nothing is typed again; a bank that wants 3-D Secure leaves the intent in `requires_action`, which the
 * browser answers with Stripe.js — redirects are switched off, so nothing depends on a return URL this
 * server would have to catch. Idempotent on the payment's own id, like every other intent here.
 */
export async function createSavedCardPaymentIntent(
	stripe: Stripe,
	payment: InboundPayment,
	customerId: string,
	paymentMethodId: string,
): Promise<IntentHandle> {
	const intent = await stripe.paymentIntents.create({
		...paymentIntentParams(payment),
		customer: customerId,
		payment_method: paymentMethodId,
		confirm: true,
		automatic_payment_methods: { enabled: true, allow_redirects: "never" },
	}, { idempotencyKey: stripeIdempotencyKey("saved_card_payment", payment.id) });
	return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
}

/**
 * Re-read a PaymentIntent a payment is already bound to — the replay path, so a retried request gets
 * the SAME intent's client secret back instead of creating a second intent once Stripe's own
 * idempotency window (24 h) has passed.
 */
export async function retrievePaymentIntent(stripe: Stripe, id: string): Promise<IntentHandle> {
	const intent = await stripe.paymentIntents.retrieve(id);
	return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
}
// #endregion

// #region Connect (payout accounts)
type AccountCreateParams = Parameters<Stripe["v2"]["core"]["accounts"]["create"]>[0];
type AccountLinkCreateParams = Parameters<Stripe["v2"]["core"]["accountLinks"]["create"]>[0];

/** The owner a connected account is created for, as `finance.payout_account_for` resolved it. */
export interface ConnectOwner {
	ownerType: PayoutAccount["ownerType"];
	ownerId: string;
	displayName: string;
	/**
	 * The onboarding person's own sign-in address. Stripe REQUIRES a contact email on any v2 account
	 * carrying the recipient configuration (`invalid_fields` without one). Passed to Stripe only —
	 * Projective never stores it in `finance.*`. `null` when the caller has none on file.
	 */
	contactEmail: string | null;
	/** ISO 3166-1 alpha-2. Fixed by Stripe at creation and never changeable afterwards. */
	country: string;
}

/**
 * The v2 account for a marketplace recipient (docs.stripe.com/connect/marketplace/tasks/create):
 * Express dashboard, the recipient configuration requesting `stripe_balance.stripe_transfers`, and
 * `fees_collector`/`losses_collector: 'application'` — the platform prices and owns negative-balance
 * liability, which is also what lets it reverse transfers when a dispute lands. No merchant
 * configuration: the freelancer is paid by transfer, never charges a card, and requesting card
 * payments would only lengthen their onboarding.
 */
export function connectAccountParams(owner: ConnectOwner): AccountCreateParams {
	return {
		...(owner.displayName ? { display_name: owner.displayName.slice(0, 120) } : {}),
		...(owner.contactEmail ? { contact_email: owner.contactEmail } : {}),
		dashboard: "express",
		identity: { country: owner.country.toLowerCase() },
		configuration: {
			recipient: {
				capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
			},
		},
		defaults: {
			responsibilities: { fees_collector: "application", losses_collector: "application" },
		},
		include: ["configuration.recipient", "requirements"],
		metadata: { projective_owner_type: owner.ownerType, projective_owner_id: owner.ownerId },
	};
}

/** The recipient transfers capability a v2 account reports, or `null` when it reports none yet. */
export function transfersCapabilityOf(account: unknown): TransfersCapabilityStatus | null {
	const status = (account as {
		configuration?: {
			recipient?: {
				capabilities?: { stripe_balance?: { stripe_transfers?: { status?: unknown } } };
			};
		};
	})?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
	return status === "active" || status === "pending" || status === "restricted" ||
			status === "unsupported"
		? status
		: null;
}

/**
 * Create the connected account for an owner. The idempotency key names the owner AND the country: a
 * retry of the same request replays the same account, while a corrected country (after Stripe refused
 * the first one) is a genuinely different request rather than an idempotency conflict.
 */
export async function createConnectAccount(
	stripe: Stripe,
	owner: ConnectOwner,
): Promise<{ id: string; capability: TransfersCapabilityStatus | null }> {
	const account = await stripe.v2.core.accounts.create(connectAccountParams(owner), {
		idempotencyKey: stripeIdempotencyKey(
			"connect_account",
			`${owner.ownerType}:${owner.ownerId}:${owner.country.toLowerCase()}`,
		),
	});
	return { id: account.id, capability: transfersCapabilityOf(account) };
}

/** Where Stripe-hosted onboarding sends the person back to. */
export interface OnboardingUrls {
	/** Hit when the link is expired or reused — must mint a fresh link and redirect to it. */
	refreshUrl: string;
	/** Hit when the person leaves the flow — must re-read the account, never assume completion. */
	returnUrl: string;
}

/**
 * The account-link request. An account that is already payable gets an `account_update` link (to
 * change bank details); anything else resumes `account_onboarding`.
 */
export function onboardingLinkParams(
	accountId: string,
	urls: OnboardingUrls,
	alreadyVerified: boolean,
): AccountLinkCreateParams {
	return alreadyVerified
		? {
			account: accountId,
			use_case: {
				type: "account_update",
				account_update: {
					configurations: ["recipient"],
					refresh_url: urls.refreshUrl,
					return_url: urls.returnUrl,
				},
			},
		}
		: {
			account: accountId,
			use_case: {
				type: "account_onboarding",
				account_onboarding: {
					configurations: ["recipient"],
					refresh_url: urls.refreshUrl,
					return_url: urls.returnUrl,
				},
			},
		};
}

/** Mint a single-use, short-lived Stripe-hosted onboarding link. */
export async function createOnboardingLink(
	stripe: Stripe,
	accountId: string,
	urls: OnboardingUrls,
	alreadyVerified: boolean,
): Promise<{ url: string; expiresAt: string }> {
	const link = await stripe.v2.core.accountLinks.create(
		onboardingLinkParams(accountId, urls, alreadyVerified),
	);
	return { url: link.url, expiresAt: link.expires_at };
}

/** Read a connected account's recipient transfers capability straight from Stripe. */
export async function retrieveTransfersCapability(
	stripe: Stripe,
	accountId: string,
): Promise<TransfersCapabilityStatus | null> {
	const account = await stripe.v2.core.accounts.retrieve(accountId, {
		include: ["configuration.recipient"],
	});
	return transfersCapabilityOf(account);
}
// #endregion

// #region Identity (KYC)
type VerificationSessionCreateParams = Parameters<
	Stripe["identity"]["verificationSessions"]["create"]
>[0];

/**
 * The Level-2 check (PRODUCT_SPEC §Identity): a government ID captured LIVE plus a matching selfie.
 * `client_reference_id` and the metadata are Projective ids only; nothing about the person is sent
 * from here, and nothing Stripe extracts from the document is ever read back (only the decision and,
 * on a failure, its error CODE).
 */
export function identitySessionParams(
	caseId: string,
	userId: string,
	returnUrl: string,
): VerificationSessionCreateParams {
	return {
		type: "document",
		options: { document: { require_live_capture: true, require_matching_selfie: true } },
		client_reference_id: caseId,
		metadata: { projective_case_id: caseId, projective_user_id: userId },
		return_url: returnUrl,
	};
}

/** What the browser needs to run a verification session. */
export interface SessionHandle {
	id: string;
	url: string | null;
	clientSecret: string | null;
	status: string;
}

/** Create the verification session for an open case. Idempotent on the case id. */
export async function createIdentitySession(
	stripe: Stripe,
	caseId: string,
	userId: string,
	returnUrl: string,
): Promise<SessionHandle> {
	const session = await stripe.identity.verificationSessions.create(
		identitySessionParams(caseId, userId, returnUrl),
		{ idempotencyKey: stripeIdempotencyKey("identity_session", caseId) },
	);
	return {
		id: session.id,
		url: session.url,
		clientSecret: session.client_secret,
		status: session.status,
	};
}
// #endregion

// #region Transfers (money out, Decision #126)
type TransferCreateParams = Parameters<Stripe["transfers"]["create"]>[0];

/** The withdrawal a transfer carries out, as `finance.begin_payout` recorded it. */
export interface PayoutTransfer {
	payoutId: string;
	amountMinor: number;
	currency: string;
	/** The owner's VERIFIED Connect account (`acct_…`). */
	destination: string;
	walletId: string;
}

/**
 * The Transfer for one withdrawal: from the platform balance to the owner's connected account, which
 * pays their bank on Stripe's own schedule (Separate Charges & Transfers). The metadata's
 * `projective_payout_id` is what `transfer.created` binds back to the payout.
 */
export function transferParams(payout: PayoutTransfer): TransferCreateParams {
	return {
		amount: payout.amountMinor,
		currency: payout.currency.toLowerCase(),
		destination: payout.destination,
		description: "Projective withdrawal",
		metadata: { projective_payout_id: payout.payoutId, projective_wallet_id: payout.walletId },
	};
}

/** Create the Transfer for a withdrawal. Idempotent on the payout id. */
export async function createTransfer(stripe: Stripe, payout: PayoutTransfer): Promise<{ id: string }> {
	const transfer = await stripe.transfers.create(transferParams(payout), {
		idempotencyKey: stripeIdempotencyKey("payout_transfer", payout.payoutId),
	});
	return { id: transfer.id };
}
// #endregion

// #region Customers + saved cards (Decision #126)
type CustomerCreateParams = Parameters<Stripe["customers"]["create"]>[0];
type SetupIntentCreateParams = Parameters<Stripe["setupIntents"]["create"]>[0];

/** The finance owner a Customer is created for, as `finance.card_owner_for` resolved it. */
export interface CardOwner {
	ownerType: string;
	ownerId: string;
	displayName: string;
	/** The caller's own sign-in address, handed to Stripe for receipts. Never stored. */
	contactEmail: string | null;
	/** Who is saving the card — stamped on the SetupIntent so the webhook backstop can credit them. */
	createdBy: string | null;
}

/** The Customer an owner's saved cards attach to. Metadata carries Projective ids only. */
export function customerParams(owner: CardOwner): CustomerCreateParams {
	return {
		...(owner.displayName ? { name: owner.displayName.slice(0, 120) } : {}),
		...(owner.contactEmail ? { email: owner.contactEmail } : {}),
		metadata: { projective_owner_type: owner.ownerType, projective_owner_id: owner.ownerId },
	};
}

/** Create an owner's Customer. Idempotent on the owner, so two racing requests share one Customer. */
export async function createCustomer(stripe: Stripe, owner: CardOwner): Promise<{ id: string }> {
	const customer = await stripe.customers.create(customerParams(owner), {
		idempotencyKey: stripeIdempotencyKey("customer", `${owner.ownerType}:${owner.ownerId}`),
	});
	return { id: customer.id };
}

/**
 * A SetupIntent that saves a card for later, OFF-SESSION use (a recurring deposit charges it with
 * nobody at the keyboard, so the bank's mandate has to be collected now). No
 * `payment_method_types`: dynamic payment methods, as for PaymentIntents.
 */
export function setupIntentParams(customerId: string, owner: CardOwner): SetupIntentCreateParams {
	return {
		customer: customerId,
		usage: "off_session",
		automatic_payment_methods: { enabled: true, allow_redirects: "never" },
		metadata: {
			projective_owner_type: owner.ownerType,
			projective_owner_id: owner.ownerId,
			...(owner.createdBy ? { projective_created_by: owner.createdBy } : {}),
		},
	};
}

/** Create a SetupIntent. Each call is a new attempt, so it carries no idempotency key of its own. */
export async function createSetupIntent(
	stripe: Stripe,
	customerId: string,
	owner: CardOwner,
): Promise<{ id: string; clientSecret: string | null }> {
	const intent = await stripe.setupIntents.create(setupIntentParams(customerId, owner));
	return { id: intent.id, clientSecret: intent.client_secret };
}

/** What a confirmed SetupIntent saved — the display facts Stripe returns, and whose it is. */
export interface ConfirmedCard {
	setupIntentId: string;
	status: string;
	customerId: string | null;
	paymentMethodId: string | null;
	brand: string | null;
	last4: string | null;
	expMonth: number | null;
	expYear: number | null;
	ownerType: string | null;
	ownerId: string | null;
	createdBy: string | null;
}

/** Read a Stripe SetupIntent object (expanded or webhook-delivered) into {@link ConfirmedCard}. */
export function confirmedCardOf(intent: unknown): ConfirmedCard {
	const i = intent as {
		id: string;
		status: string;
		customer?: unknown;
		payment_method?: unknown;
		metadata?: Record<string, string> | null;
	};
	const pm = i.payment_method && typeof i.payment_method === "object"
		? i.payment_method as { id?: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } }
		: null;
	const idOf = (ref: unknown): string | null =>
		typeof ref === "string" ? ref : ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string"
			? (ref as { id: string }).id
			: null;
	return {
		setupIntentId: i.id,
		status: i.status,
		customerId: idOf(i.customer),
		paymentMethodId: idOf(i.payment_method),
		brand: pm?.card?.brand ?? null,
		last4: pm?.card?.last4 ?? null,
		expMonth: typeof pm?.card?.exp_month === "number" ? pm.card.exp_month : null,
		expYear: typeof pm?.card?.exp_year === "number" ? pm.card.exp_year : null,
		ownerType: i.metadata?.projective_owner_type ?? null,
		ownerId: i.metadata?.projective_owner_id ?? null,
		createdBy: i.metadata?.projective_created_by ?? null,
	};
}

/** Re-read a SetupIntent with its payment method expanded — the fact the browser's word is checked against. */
export async function retrieveConfirmedCard(stripe: Stripe, setupIntentId: string): Promise<ConfirmedCard> {
	const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
	return confirmedCardOf(intent);
}

/**
 * Charge a saved card OFF-SESSION for one scheduled deposit: confirmed at creation with the saved
 * payment method, on the platform account, settled like any top-up by `payment_intent.succeeded`.
 * Idempotent on the scheduled payment's id, so a scheduler that runs twice creates one charge.
 */
export async function createOffSessionPaymentIntent(
	stripe: Stripe,
	payment: InboundPayment,
	customerId: string,
	paymentMethodId: string,
): Promise<IntentHandle> {
	const intent = await stripe.paymentIntents.create({
		...paymentIntentParams(payment),
		customer: customerId,
		payment_method: paymentMethodId,
		off_session: true,
		confirm: true,
		description: "Projective recurring deposit",
	}, { idempotencyKey: stripeIdempotencyKey("scheduled_deposit", payment.id) });
	return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
}
// #endregion
