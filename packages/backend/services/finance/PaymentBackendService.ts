import {
	type CardPaymentHandoff,
	type CardSetupConfig,
	type CheckoutOrderLink,
	type CardSetupHandoff,
	type ConfirmCardSetup,
	type ConnectAccountStatus,
	type ConnectOnboardingInput,
	type ConnectOnboardingLink,
	type CreateCardSetup,
	type CreateEscrowLockIntent,
	type CreateTopUpIntent,
	DEFAULT_LOCALE,
	formatMoney,
	type IdentitySessionHandoff,
	type InboundPayment,
	isHandledStripeEvent,
	isHandledStripeThinEvent,
	type KybOnboardingInput,
	type OnboardingReturn,
	type PayoutAccountScope,
	payoutAccountStatusFor,
	type PayoutResult,
	type SavedCardResult,
	type StripeWebhookOutcome,
	type StripeWebhookReceipt,
	type TransfersCapabilityStatus,
	type VerificationStatus,
} from "@projective/types/finance";
import { serverEnv } from "../../core/env.ts";
import {
	getStripe,
	type StripeSettings,
	stripeSettings,
	verifyStripeEvent,
} from "../../core/stripe.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	abandonCardPayment,
	abandonIdentityVerification,
	attachCardPayment,
	attachCheckoutOrder,
	attachIdentitySession,
	beginCardPayment,
	beginIdentityVerification,
	beginPayout,
	bindScheduledPayment,
	cardOwnerFor,
	claimDueDepositRules,
	completePayout,
	type DbRefusal,
	ensurePurchaseWallet,
	failPayout,
	myVerificationStatus,
	payoutAccountFor,
	type PayoutAccountLookup,
	recordPayoutAccount,
	recordProcessorCustomer,
	readInboundPayment,
	recordSavedCard,
	syncPayoutAccount,
} from "./live-payments.ts";
import {
	classifyStripeError,
	createConnectAccount,
	createCustomer,
	createIdentitySession,
	createSavedCardPaymentIntent,
	customerOfPaymentMethod,
	createOffSessionPaymentIntent,
	createOnboardingLink,
	createPaymentIntent,
	createSetupIntent,
	createTransfer,
	type IntentHandle,
	retrieveConfirmedCard,
	retrievePaymentIntent,
	retrieveTransfersCapability,
	type StripeFailure,
} from "./stripe-rails.ts";
import { applyStripePlan, planStripeEvent, syncConnectAccount } from "./stripe-webhook.ts";

/**
 * PaymentBackendService — the FAT half of the Stripe fiat rails, Phase 1 (root CLAUDE.md §8
 * Decision #125; SYSTEM_ARCHITECTURE §Integration Blueprints → Stripe). The `PaymentService` the
 * architecture names.
 *
 * Every user-initiated method follows one order, and the order is the safety property:
 *
 * 1. **Gate.** A signed-in caller (401), then `FINANCE_BACKEND_LIVE` AND a well-formed Stripe key
 *    (503 "not connected here") — so a half-configured environment refuses instead of half-working.
 * 2. **Record the request** through a user door (`finance.begin_*`), authorised as the caller by the
 *    database. The amount of an escrow lock is computed there, never taken from the browser.
 * 3. **Call Stripe** with an `Idempotency-Key` derived from the row step 2 wrote, so a retry can never
 *    create a second object for one attempt.
 * 4. **Bind** the Stripe object to the row (`finance.attach_*`), write-once.
 *
 * Nothing here marks money received, an account payable or an identity verified: those facts arrive
 * only through {@link handleStripeWebhook} (signature-verified) or a status the service read from
 * Stripe itself, and are applied by service-role doors no user can call.
 *
 * The charge pattern is Separate Charges & Transfers — the card is charged on the PLATFORM account and
 * credited to a Projective wallet; payouts transfer to connected accounts later. Not destination
 * charges, which would hand the money to a connected account the moment it is paid (Decision #125).
 */

type Result<T> = ServiceResult<T>;

// #region Plumbing
const NOT_CONNECTED = "Card payments aren't connected in this environment.";

function signedOut<T>(message = "Sign in to continue."): Result<T> {
	return fail(401, { message });
}

function notConnected<T>(message = NOT_CONNECTED): Result<T> {
	return fail(503, { message });
}

function refused<T>(refusal: DbRefusal): Result<T> {
	return fail(refusal.status, { message: refusal.message, errors: refusal.errors });
}

/** The Stripe settings, when payments may call Stripe here; `null` otherwise. */
function liveSettings(): StripeSettings | null {
	return isFinanceBackendLive() ? stripeSettings() : null;
}

/** Answer a Stripe failure. Stripe's own text goes to the log, never to the browser. */
function stripeFailed<T>(label: string, failure: StripeFailure, refusedMessage: string): Result<T> {
	console.error(`[payments:${label}]`, failure.kind, failure.code ?? "", failure.message);
	switch (failure.kind) {
		case "refused":
			return fail(422, { message: refusedMessage });
		case "misconfigured":
			return fail(503, { message: "Payments are misconfigured here. Nothing was charged." });
		default:
			return fail(503, {
				message: "Couldn't reach the payment processor. Try again — nothing was charged twice.",
			});
	}
}

/** An absolute URL on the app's public origin (`APP_URL`), for Stripe to redirect a browser to. */
function appUrl(path: string, params: Record<string, string | null | undefined> = {}): string {
	const url = new URL(path, serverEnv().appUrl);
	for (const [key, value] of Object.entries(params)) {
		if (value) url.searchParams.set(key, value);
	}
	return url.toString();
}

/** The query that addresses a payout account's owner (and where to land) on the connect routes. */
function ownerParams(owner: PayoutAccountScope, back?: OnboardingReturn | null): Record<string, string | null> {
	return {
		scope: owner.scope,
		teamId: owner.scope === "team" ? owner.teamId ?? null : null,
		businessId: owner.scope === "business" ? owner.businessId ?? null : null,
		back: back === "settings" ? "settings" : null,
	};
}
// #endregion

// #region Card payments
/**
 * What the browser does next with an intent, read off Stripe's own status: take a card, answer the
 * bank's challenge, or just wait for the webhook.
 */
function confirmationOf(status: string): CardPaymentHandoff["confirmation"] {
	if (status === "requires_action") return "authenticate";
	if (status === "processing" || status === "succeeded" || status === "requires_capture") return "none";
	return "collect";
}

/** The browser handoff for a bound payment. */
function handoffOf(
	payment: InboundPayment,
	intent: IntentHandle,
	settings: StripeSettings,
	replayed: boolean,
): Result<CardPaymentHandoff> {
	if (!intent.clientSecret) {
		console.error("[payments:intent] PaymentIntent returned no client secret", intent.id);
		return fail(502, {
			message: "The payment processor didn't return a way to confirm this payment.",
		});
	}
	return ok({
		paymentId: payment.id,
		purpose: payment.purpose,
		status: payment.status,
		lockStatus: payment.lockStatus,
		amount: {
			minor: payment.amountCents,
			currency: payment.currency,
			display: formatMoney(payment.amountCents, payment.currency, DEFAULT_LOCALE),
			origin: null,
		},
		providerRef: intent.id,
		clientSecret: intent.clientSecret,
		publishableKey: settings.publishableKey,
		mode: settings.mode,
		replayed,
		confirmation: confirmationOf(intent.status),
	}, { status: replayed ? 200 : 201 });
}

/**
 * The shared flow behind every card-payment entry point. With `savedCard` (a `pm_…` the payer's
 * members can see), that card is charged in place; without it the browser collects a card.
 */
async function cardPayment(
	actor: ReadActor,
	request: Parameters<typeof beginCardPayment>[1],
	savedCard: string | null = null,
	checkout: CheckoutOrderLink | null = null,
): Promise<Result<CardPaymentHandoff>> {
	if (!canReadLive(actor)) return signedOut("Sign in to pay.");
	const settings = liveSettings();
	if (!settings) return notConnected();

	const begun = await beginCardPayment(actor.accessToken, request);
	if (!begun.ok) return refused(begun.refusal);
	let payment = begun.value.payment;
	const replayed = begun.value.replayed;

	// The order this top-up pays for is named BEFORE any intent exists: a saved card is confirmed
	// server-side the moment its intent is created, and the webhook settling it must already know
	// which order to place (Decision #153). Write-once, so a replayed attempt re-names the same one.
	if (checkout && payment.status === "requires_payment") {
		const linked = await attachCheckoutOrder(actor.accessToken, payment.id, checkout);
		if (!linked.ok) return refused(linked.refusal);
		if (linked.value) payment = linked.value;
	}

	// A replayed key names an attempt that already ended one way or another; its key cannot start
	// another payment, and saying so is better than handing back a secret for a dead intent.
	if (payment.status === "succeeded") {
		return fail(409, { message: "This payment has already been made." });
	}
	if (payment.status === "canceled") {
		return fail(409, {
			message: `That payment attempt ended${
				payment.failureReason ? ` (${payment.failureReason})` : ""
			}. Start a new one.`,
		});
	}

	const stripe = getStripe();
	let intent: IntentHandle;
	try {
		if (payment.providerRef) {
			intent = await retrievePaymentIntent(stripe, payment.providerRef);
		} else if (savedCard) {
			// The Customer is read from Stripe, where the card lives: a card the ledger lists but Stripe
			// no longer holds (detached, or a record from before the rails) is refused, not guessed at.
			const customer = await customerOfPaymentMethod(stripe, savedCard).catch(() => null);
			if (!customer) {
				await abandonCardPayment(actor.accessToken, payment.id, "saved card unavailable");
				return fail(422, {
					message: "That card can't be charged. Choose another card, or add a new one.",
				});
			}
			intent = await createSavedCardPaymentIntent(stripe, payment, customer, savedCard);
		} else {
			intent = await createPaymentIntent(stripe, payment);
		}
	} catch (error) {
		const failure = classifyStripeError(error);
		if (failure.kind === "refused" && !payment.providerRef) {
			await abandonCardPayment(
				actor.accessToken,
				payment.id,
				failure.code ?? "refused by the processor",
			);
		}
		return stripeFailed(
			"intent",
			failure,
			savedCard
				? "The card was declined. Nothing was charged — choose another card."
				: "The payment processor refused this payment. Nothing was charged.",
		);
	}

	if (!payment.providerRef) {
		const bound = await attachCardPayment(actor.accessToken, payment.id, intent.id);
		if (!bound.ok) {
			// A PaymentIntent now exists that the ledger could not bind. It cannot be charged without its
			// client secret, which is withheld here; the next retry under the same key re-creates the SAME
			// intent (Stripe idempotency) and binds it.
			console.error("[payments:intent] could not bind", intent.id, bound.refusal.message);
			return refused(bound.refusal);
		}
		payment = bound.value;
	}
	return handoffOf(payment, intent, settings, replayed);
}

// #endregion

// #region Connect
/** The status projection for an owner, from a lookup plus whatever Stripe just reported. */
function accountStatusOf(
	lookup: PayoutAccountLookup,
	capability: TransfersCapabilityStatus | null,
	override?: { status: ConnectAccountStatus["status"]; payoutReady: boolean },
): ConnectAccountStatus {
	return {
		ownerType: lookup.ownerType,
		ownerId: lookup.ownerId,
		accountId: lookup.account?.accountId ?? null,
		status: override?.status ?? lookup.account?.status ?? "not_started",
		transfersCapability: capability,
		payoutReady: override?.payoutReady ?? lookup.payoutReady,
	};
}

/**
 * A same-origin PATH to send a browser back to, or the fallback. Never an absolute URL: a return target
 * a caller could choose would turn Stripe's hosted page into an open redirect wearing this domain.
 */
function safeReturnPath(path: string | undefined, fallback: string): string {
	return path && /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/.test(path) ? path : fallback;
}

/** The refresh/return URLs Stripe-hosted onboarding sends the person back to. */
function onboardingUrls(owner: PayoutAccountScope, back?: OnboardingReturn | null) {
	return {
		refreshUrl: appUrl("/api/finance/connect/refresh", ownerParams(owner, back)),
		returnUrl: appUrl("/api/finance/connect/return", ownerParams(owner, back)),
	};
}
// #endregion

export class PaymentBackendService {
	// #region Money in
	/**
	 * Fund a stage's escrow by card — the One-Off upfront lock and the Pipeline "Buy Now" lock. The
	 * database computes the amount (the sum the escrow hold will take) and refuses if it differs from
	 * what the payer was shown. On `payment_intent.succeeded` the money is credited to the paying
	 * business's wallet and the stage is funded from it, as the payer, re-authorised at that moment.
	 */
	static createEscrowLockIntent(
		input: CreateEscrowLockIntent,
		actor: ReadActor,
	): Promise<Result<CardPaymentHandoff>> {
		return cardPayment(actor, {
			purpose: "escrow_lock",
			walletId: null,
			projectId: input.projectId,
			stageId: input.stageId,
			expectedAmountMinor: input.expectedAmountMinor,
			currency: input.currency,
			idempotencyKey: input.idempotencyKey,
		});
	}

	/**
	 * Top a wallet up by card — the processor half of the wallet's Top up action. Credited on
	 * `payment_intent.succeeded`, never on the browser's word.
	 */
	static createTopUpIntent(
		input: CreateTopUpIntent,
		actor: ReadActor,
	): Promise<Result<CardPaymentHandoff>> {
		return cardPayment(actor, {
			purpose: "wallet_topup",
			walletId: input.walletId,
			projectId: null,
			stageId: null,
			expectedAmountMinor: input.amountMinor,
			currency: input.currency,
			idempotencyKey: input.idempotencyKey,
		});
	}

	/**
	 * Pay for a checkout by card or express wallet: the charge is a top-up of the PAYING account's
	 * wallet (created in the charge currency if it has none), after which the order is settled from
	 * that wallet exactly as a wallet purchase is — one charge path, one ledger (the model every escrow
	 * lock already follows). The browser confirms the returned PaymentIntent, waits for
	 * {@link paymentStatus} to report it settled, then places the wallet order; when `checkout` is
	 * given, the settling webhook ALSO places it, as the payer, under the same key — so the order exists
	 * even if the browser never comes back (Decision #153), and whichever arrives second replays.
	 */
	static async createCheckoutCardPayment(
		input: {
			ownerType: string;
			ownerId: string;
			amountMinor: number;
			currency: string;
			idempotencyKey: string;
			/** The saved card's `pm_…` to charge in place; `null` to collect a card in the browser. */
			savedCardRef?: string | null;
			/** The order this top-up pays for — placed by the settling webhook if the browser does not. */
			checkout?: CheckoutOrderLink | null;
		},
		actor: ReadActor,
	): Promise<Result<CardPaymentHandoff>> {
		if (!canReadLive(actor)) return signedOut("Sign in to pay.");
		if (!liveSettings()) return notConnected();
		const wallet = await ensurePurchaseWallet(actor.accessToken, input.ownerType, input.ownerId, input.currency);
		if (!wallet.ok) return refused(wallet.refusal);
		return cardPayment(actor, {
			purpose: "wallet_topup",
			walletId: wallet.value,
			projectId: null,
			stageId: null,
			expectedAmountMinor: input.amountMinor,
			currency: input.currency.toUpperCase(),
			idempotencyKey: input.idempotencyKey,
		}, input.savedCardRef ?? null, input.checkout ?? null);
	}

	/**
	 * Where one card payment stands, for the surface that is waiting on it: `succeeded` only once the
	 * signed webhook has credited the wallet — never on the browser's word.
	 */
	static async paymentStatus(
		paymentId: string,
		actor: ReadActor,
	): Promise<Result<{ payment: InboundPayment }>> {
		if (!canReadLive(actor)) return signedOut("Sign in to see this payment.");
		if (!isFinanceBackendLive()) return notConnected();
		try {
			const payment = await readInboundPayment(actor.accessToken, paymentId);
			if (!payment) return fail(404, { message: "That payment wasn't found." });
			return ok({ payment });
		} catch (error) {
			console.error("[payments:status]", error instanceof Error ? error.message : error);
			return fail(503, { message: "Couldn't read that payment just now." });
		}
	}
	// #endregion

	// #region Payout accounts
	/**
	 * Start or resume Stripe-hosted payout onboarding: creates the owner's connected account on first
	 * use (Accounts v2, Express dashboard, recipient configuration), records it, and returns a fresh
	 * single-use link. An account that is already payable gets an update link instead.
	 */
	static async startConnectOnboarding(
		input: ConnectOnboardingInput,
		actor: ReadActor,
	): Promise<Result<ConnectOnboardingLink>> {
		if (!canReadLive(actor)) return signedOut("Sign in to set up payouts.");
		if (!liveSettings()) return notConnected("Payouts aren't connected in this environment.");
		const owner: PayoutAccountScope = {
			scope: input.scope,
			teamId: input.teamId ?? null,
			businessId: input.businessId ?? null,
		};

		const lookup = await payoutAccountFor(actor.accessToken, owner);
		if (!lookup.ok) return refused(lookup.refusal);
		const stripe = getStripe();

		let account = lookup.value.account;
		let capability: TransfersCapabilityStatus | null = null;
		if (!account) {
			let created: { id: string; capability: TransfersCapabilityStatus | null };
			try {
				created = await createConnectAccount(stripe, {
					ownerType: lookup.value.ownerType,
					ownerId: lookup.value.ownerId,
					displayName: lookup.value.displayName,
					contactEmail: lookup.value.contactEmail,
					country: input.country,
				});
			} catch (error) {
				return stripeFailed(
					"connect:create",
					classifyStripeError(error),
					"Stripe couldn't open a payout account for that country. Check it and try again.",
				);
			}
			const recorded = await recordPayoutAccount(actor.accessToken, owner, created.id);
			if (!recorded.ok) return refused(recorded.refusal);
			account = recorded.value;
			capability = created.capability;
			// The row is recorded as `pending_verification`; Stripe has already said where the new
			// account stands, so store THAT, or this response and the next status read disagree.
			const reported = capability ? payoutAccountStatusFor(capability) : null;
			if (reported && reported !== account.status) {
				try {
					await syncPayoutAccount(account.accountId, reported);
					account = { ...account, status: reported };
				} catch (error) {
					console.error("[payments:connect:sync]", error instanceof Error ? error.message : error);
				}
			}
		}

		try {
			const link = await createOnboardingLink(
				stripe,
				account.accountId,
				onboardingUrls(owner, input.returnTo),
				account.status === "verified",
			);
			return ok({
				url: link.url,
				expiresAt: link.expiresAt,
				account: accountStatusOf({ ...lookup.value, account }, capability),
			}, { status: 201 });
		} catch (error) {
			return stripeFailed(
				"connect:link",
				classifyStripeError(error),
				"Stripe couldn't open onboarding for this account right now.",
			);
		}
	}

	/**
	 * A fresh onboarding link for an EXISTING account — what Stripe's `refresh_url` needs (a link is
	 * single-use and short-lived). Never creates an account: a refresh with no account is a 404.
	 */
	static async refreshConnectOnboarding(
		owner: PayoutAccountScope,
		actor: ReadActor,
		back?: OnboardingReturn | null,
	): Promise<Result<{ url: string }>> {
		if (!canReadLive(actor)) return signedOut("Sign in to set up payouts.");
		if (!liveSettings()) return notConnected("Payouts aren't connected in this environment.");
		const lookup = await payoutAccountFor(actor.accessToken, owner);
		if (!lookup.ok) return refused(lookup.refusal);
		const account = lookup.value.account;
		if (!account) return fail(404, { message: "Start payout setup first." });
		try {
			const link = await createOnboardingLink(
				getStripe(),
				account.accountId,
				onboardingUrls(owner, back),
				account.status === "verified",
			);
			return ok({ url: link.url });
		} catch (error) {
			return stripeFailed(
				"connect:refresh",
				classifyStripeError(error),
				"Stripe couldn't reopen onboarding for this account right now.",
			);
		}
	}

	/**
	 * Where the owner's payout account stands. With `sync`, the account is re-read from Stripe and a
	 * changed status is applied through the service-role door — which also keeps the person's
	 * `payout_ready` earning gate in step. A Stripe that cannot be reached leaves the stored status
	 * standing (and says the capability is unknown) rather than failing the read.
	 */
	static async connectStatus(
		owner: PayoutAccountScope,
		actor: ReadActor,
		opts: { sync: boolean },
	): Promise<Result<ConnectAccountStatus>> {
		if (!canReadLive(actor)) return signedOut("Sign in to see your payouts.");
		if (!isFinanceBackendLive()) {
			return notConnected("Payouts aren't connected in this environment.");
		}
		const lookup = await payoutAccountFor(actor.accessToken, owner);
		if (!lookup.ok) return refused(lookup.refusal);
		const account = lookup.value.account;
		if (!account || !opts.sync || !stripeSettings()) return ok(accountStatusOf(lookup.value, null));

		let capability: TransfersCapabilityStatus | null;
		try {
			capability = await retrieveTransfersCapability(getStripe(), account.accountId);
		} catch (error) {
			console.error("[payments:connect:status]", classifyStripeError(error).message);
			return ok(accountStatusOf(lookup.value, null));
		}
		const status = payoutAccountStatusFor(capability);
		if (status === account.status) return ok(accountStatusOf(lookup.value, capability));
		try {
			const synced = await syncPayoutAccount(account.accountId, status);
			return ok(
				accountStatusOf(lookup.value, capability, { status, payoutReady: synced.payoutReady }),
			);
		} catch (error) {
			console.error("[payments:connect:sync]", error instanceof Error ? error.message : error);
			return ok(accountStatusOf(lookup.value, capability));
		}
	}
	// #endregion

	// #region Identity
	/**
	 * Start a Stripe Identity check (government ID captured live + a matching selfie) for the calling
	 * freelancer — the Level-2 KYC half of the earning gate. The DECISION arrives only through the
	 * webhook; this returns the hosted `url` and the Stripe.js `clientSecret`, either of which runs it.
	 */
	static async createIdentitySession(
		actor: ReadActor,
		opts: { returnPath?: string } = {},
	): Promise<Result<IdentitySessionHandoff>> {
		if (!canReadLive(actor)) return signedOut("Sign in to verify your identity.");
		const settings = liveSettings();
		if (!settings) return notConnected("Identity checks aren't connected in this environment.");

		const begun = await beginIdentityVerification(actor.accessToken);
		if (!begun.ok) return refused(begun.refusal);
		const opened = begun.value;

		let session;
		try {
			session = await createIdentitySession(
				getStripe(),
				opened.id,
				actor.userId,
				appUrl(safeReturnPath(opts.returnPath, "/wallet"), { identity: "returned" }),
			);
		} catch (error) {
			const failure = classifyStripeError(error);
			if (failure.kind === "refused") {
				await abandonIdentityVerification(
					actor.accessToken,
					opened.id,
					failure.code ?? "refused by the processor",
				);
			}
			return stripeFailed(
				"identity",
				failure,
				"Stripe couldn't start an identity check right now.",
			);
		}

		const bound = await attachIdentitySession(actor.accessToken, opened.id, session.id);
		if (!bound.ok) {
			console.error("[payments:identity] could not bind", session.id, bound.refusal.message);
			return refused(bound.refusal);
		}
		return ok({
			caseId: bound.value.id,
			status: bound.value.status,
			providerRef: session.id,
			url: session.url,
			clientSecret: session.clientSecret,
			publishableKey: settings.publishableKey,
			mode: settings.mode,
		}, { status: 201 });
	}
	// #endregion

	// #region Verification (Level-2 KYC · Level-3 KYB) — /settings/verification
	/**
	 * The caller's verification picture: their own KYC, their personal payout account, and the KYB of
	 * every client business they belong to. Statuses only.
	 */
	static async verificationStatus(actor: ReadActor): Promise<Result<VerificationStatus>> {
		if (!canReadLive(actor)) return signedOut("Sign in to see your verification.");
		if (!isFinanceBackendLive()) {
			return notConnected("Verification isn't connected in this environment.");
		}
		const row = await myVerificationStatus(actor.accessToken);
		if (!row.ok) return refused(row.refusal);
		const payout = await PaymentBackendService.connectStatus(
			{ scope: "personal", teamId: null, businessId: null },
			actor,
			{ sync: false },
		);
		return ok({
			...row.value,
			kycTier: row.value.kycTier as 1 | 2 | 3 | null,
			payoutAccount: payout.ok && payout.data ? payout.data : null,
			processorConnected: liveSettings() !== null,
		});
	}

	/**
	 * Start (or resume) the Level-3 KYB check for a client business: Stripe Connect onboarding for the
	 * business's own account. A verified account marks the business KYB-verified
	 * (`finance.sync_payout_account`); the return URL lands on `/settings/verification`.
	 */
	static startKybOnboarding(
		input: KybOnboardingInput,
		actor: ReadActor,
	): Promise<Result<ConnectOnboardingLink>> {
		return PaymentBackendService.startConnectOnboarding({
			scope: "business",
			teamId: null,
			businessId: input.businessId,
			country: input.country,
			returnTo: "settings",
		}, actor);
	}
	// #endregion

	// #region Money out — withdrawals
	/**
	 * Withdraw from a wallet to its owner's verified Connect account. The database authorises, applies
	 * the earning gates and DEBITS the wallet (`finance.begin_payout`); then the Transfer is created,
	 * idempotent on the payout id. A definitive Stripe refusal returns the money (`finance.fail_payout`);
	 * an unknown answer (network, 5xx) leaves the payout pending with the money held — retrying the same
	 * attempt key re-sends the SAME transfer request, and `transfer.created` closes it either way.
	 */
	static async withdraw(
		input: { walletId: string; amountMinor: number; currency: string; instant: boolean; idempotencyKey: string },
		actor: ReadActor,
	): Promise<Result<PayoutResult>> {
		if (!canReadLive(actor)) return signedOut("Sign in to withdraw.");
		if (!liveSettings()) return notConnected("Withdrawals aren't connected in this environment.");

		const begun = await beginPayout(actor.accessToken, input);
		if (!begun.ok) return refused(begun.refusal);
		const { payout, destination, replayed } = begun.value;
		if (payout.status !== "pending" || !destination) {
			return ok({ payout, destination, replayed }, { status: 200 });
		}

		let transferId: string;
		try {
			transferId = (await createTransfer(getStripe(), {
				payoutId: payout.id,
				amountMinor: payout.amountCents,
				currency: payout.currency,
				destination,
				walletId: payout.walletId,
			})).id;
		} catch (error) {
			const failure = classifyStripeError(error);
			if (failure.kind === "refused") {
				await failPayout(payout.id, failure.code ?? "refused by the processor");
				console.error("[payments:payout]", failure.code ?? "", failure.message);
				return fail(422, {
					message: "Stripe couldn't send this payout. The money is back in your wallet.",
				});
			}
			console.error("[payments:payout]", failure.kind, failure.message);
			return ok({ payout, destination, replayed }, {
				status: 202,
				message: "Your payout is on its way; its confirmation is still arriving.",
			});
		}
		const paid = await completePayout(payout.id, transferId);
		return ok({ payout: paid, destination, replayed }, { status: replayed ? 200 : 201 });
	}
	// #endregion

	// #region Saved cards
	/**
	 * What the browser needs to mount the card form BEFORE a SetupIntent exists (Stripe's deferred-intent
	 * flow): the publishable key and the mode, and nothing that names an owner. The form collects the
	 * card first; {@link createCardSetup} opens the SetupIntent only when the person presses Save, so an
	 * Add card dialog that is opened and abandoned creates nothing at Stripe. Gated like every other
	 * card call — signed in (401), then connected here (503) — so a page never mounts a form whose Save
	 * could only be refused.
	 */
	static cardSetupConfig(actor: ReadActor): Result<CardSetupConfig> {
		if (!canReadLive(actor)) return signedOut("Sign in to save a card.");
		const settings = liveSettings();
		if (!settings) return notConnected("Saving cards isn't connected in this environment.");
		return ok({ publishableKey: settings.publishableKey, mode: settings.mode });
	}

	/**
	 * Start saving a card: resolve (and authorise) the owner, make sure they have a Stripe Customer —
	 * created once, recorded through the database so two racing requests share one — and open a
	 * SetupIntent for the Payment Element. Called when the person presses Save, after the form has
	 * collected the card (the intent matches the card-only form, `setupIntentParams`). Nothing is saved
	 * until {@link confirmCardSetup}.
	 */
	static async createCardSetup(input: CreateCardSetup, actor: ReadActor): Promise<Result<CardSetupHandoff>> {
		if (!canReadLive(actor)) return signedOut("Sign in to save a card.");
		const settings = liveSettings();
		if (!settings) return notConnected("Saving cards isn't connected in this environment.");
		const contextId = input.scope === "personal" ? null : input.contextId ?? null;

		const owner = await cardOwnerFor(actor.accessToken, input.scope, contextId);
		if (!owner.ok) return refused(owner.refusal);
		const stripe = getStripe();
		const cardOwner = {
			ownerType: owner.value.ownerType,
			ownerId: owner.value.ownerId,
			displayName: owner.value.displayName,
			contactEmail: owner.value.contactEmail,
			createdBy: actor.userId,
		};

		let customerRef = owner.value.customerRef;
		try {
			if (!customerRef) {
				const created = await createCustomer(stripe, cardOwner);
				const recorded = await recordProcessorCustomer(actor.accessToken, input.scope, contextId, created.id);
				if (!recorded.ok) return refused(recorded.refusal);
				customerRef = recorded.value;
			}
			const intent = await createSetupIntent(stripe, customerRef, cardOwner);
			if (!intent.clientSecret) {
				return fail(502, { message: "Stripe didn't return a way to save this card." });
			}
			return ok({
				setupIntentId: intent.id,
				clientSecret: intent.clientSecret,
				publishableKey: settings.publishableKey,
				mode: settings.mode,
				scope: input.scope,
				contextId,
			}, { status: 201 });
		} catch (error) {
			return stripeFailed("card:setup", classifyStripeError(error), "Stripe couldn't start saving a card.");
		}
	}

	/**
	 * Record the card a SetupIntent saved. The browser's "it worked" is only a prompt: the SetupIntent is
	 * re-read from Stripe and must have succeeded, on THIS owner's Customer, for THIS owner — then the
	 * card's display facts (brand, last four, expiry) are recorded through the service-role door.
	 */
	static async confirmCardSetup(input: ConfirmCardSetup, actor: ReadActor): Promise<Result<SavedCardResult>> {
		if (!canReadLive(actor)) return signedOut("Sign in to save a card.");
		if (!liveSettings()) return notConnected("Saving cards isn't connected in this environment.");
		const contextId = input.scope === "personal" ? null : input.contextId ?? null;

		const owner = await cardOwnerFor(actor.accessToken, input.scope, contextId);
		if (!owner.ok) return refused(owner.refusal);

		let card;
		try {
			card = await retrieveConfirmedCard(getStripe(), input.setupIntentId);
		} catch (error) {
			return stripeFailed("card:confirm", classifyStripeError(error), "That card setup wasn't found.");
		}
		if (
			card.status !== "succeeded" || !card.paymentMethodId ||
			!owner.value.customerRef || card.customerId !== owner.value.customerRef ||
			card.ownerType !== owner.value.ownerType || card.ownerId !== owner.value.ownerId
		) {
			return fail(409, { message: "That card hasn't been confirmed for this account." });
		}
		try {
			const saved = await recordSavedCard({
				ownerType: owner.value.ownerType,
				ownerId: owner.value.ownerId,
				paymentMethodRef: card.paymentMethodId,
				brand: card.brand,
				last4: card.last4,
				expMonth: card.expMonth,
				expYear: card.expYear,
				createdBy: actor.userId,
				makeDefault: input.makeDefault === true,
			});
			return ok(saved, { status: 201 });
		} catch (error) {
			console.error("[payments:card:record]", error instanceof Error ? error.message : error);
			return fail(503, { message: "The card was saved at Stripe but couldn't be recorded. Try again." });
		}
	}
	// #endregion

	// #region Scheduled deposits
	/**
	 * Whether a scheduler's `Authorization: Bearer …` header carries `FINANCE_CRON_SECRET` (≥ 32
	 * characters; a placeholder or a short secret authorises nothing). Compared in constant time.
	 */
	static isCronAuthorised(authorization: string | null): boolean {
		const secret = serverEnv().financeCronSecret?.trim() ?? "";
		if (secret.length < 32) return false;
		const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
		const a = new TextEncoder().encode(token);
		const b = new TextEncoder().encode(secret);
		if (a.length !== b.length) return false;
		let diff = 0;
		for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
		return diff === 0;
	}

	/**
	 * Charge every recurring deposit that is due — run by the scheduler (`POST /api/finance/cron/deposits`).
	 * Each claimed run is an inbound payment made by the rule's author; its off-session PaymentIntent is
	 * idempotent on that payment's id and settles through the ordinary webhook. A card the bank refuses
	 * counts against the rule (three strikes pause it).
	 */
	static async processDueDeposits(
		limit = 50,
	): Promise<Result<{ claimed: number; charged: number; refused: number; pending: number }>> {
		if (!liveSettings()) return notConnected("Recurring deposits aren't connected in this environment.");
		const claimed = await claimDueDepositRules(limit);
		const stripe = getStripe();
		let charged = 0;
		let refusedCount = 0;
		let pending = 0;
		for (const run of claimed) {
			try {
				const intent = await createOffSessionPaymentIntent(stripe, run.payment, run.customerRef, run.paymentMethodRef);
				await bindScheduledPayment(run.payment.id, intent.id, null);
				charged++;
			} catch (error) {
				const failure = classifyStripeError(error);
				if (failure.kind === "refused") {
					const intentId = (error as { raw?: { payment_intent?: { id?: string } } })?.raw?.payment_intent?.id ?? null;
					await bindScheduledPayment(run.payment.id, intentId, failure.code ?? "card refused");
					refusedCount++;
				} else {
					console.error("[payments:deposits]", run.payment.id, failure.kind, failure.message);
					pending++;
				}
			}
		}
		return ok({ claimed: claimed.length, charged, refused: refusedCount, pending });
	}
	// #endregion

	// #region Webhook
	/**
	 * Verify and apply one Stripe webhook delivery. `payload` must be the RAW body — the signature is an
	 * HMAC over the exact bytes.
	 *
	 * Status contract (Stripe retries any non-2xx for days): 400 for a missing or forged signature,
	 * 503 while webhooks are not configured here, 500 when the ledger could not record the event (so it
	 * is redelivered — safe, because every door is idempotent on the event id), and 200 for everything
	 * else, INCLUDING an event this endpoint ignores or cannot match: acknowledging it is what stops the
	 * retries, and the claim row keeps it for reconciliation.
	 */
	static async handleStripeWebhook(
		payload: string,
		signature: string | null,
	): Promise<Result<StripeWebhookReceipt>> {
		const settings = liveSettings();
		if (!settings?.webhookSecret) return notConnected("Stripe webhooks aren't configured here.");
		if (!signature) return fail(400, { message: "Missing Stripe-Signature header." });

		let event;
		try {
			event = await verifyStripeEvent(payload, signature, settings.webhookSecret);
		} catch (error) {
			const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
			console.warn("[payments:webhook] rejected delivery:", reason);
			return fail(400, { message: "Invalid Stripe signature." });
		}

		const receipt = (
			outcome: StripeWebhookOutcome,
			detail: string | null,
		): Result<StripeWebhookReceipt> =>
			ok({ received: true, eventId: event.id, type: event.type, outcome, detail });

		if (!isHandledStripeEvent(event.type)) return receipt("ignored", "event type not handled");
		// A test-mode event reaching a live deployment (or the reverse) is someone's misrouted endpoint,
		// never money this ledger should move.
		if (event.livemode !== (settings.mode === "live")) {
			return receipt(
				"ignored",
				`a ${event.livemode ? "live" : "test"}-mode event on a ${settings.mode}-mode deployment`,
			);
		}
		const plan = planStripeEvent(event);
		if (plan.kind === "ignore") return receipt("ignored", plan.reason);

		try {
			const applied = await applyStripePlan(event.id, plan, event.livemode);
			return receipt(applied.outcome, applied.detail);
		} catch (error) {
			console.error(
				"[payments:webhook]",
				event.id,
				event.type,
				error instanceof Error ? error.message : error,
			);
			return fail(500, { message: "The event could not be recorded; Stripe will retry it." });
		}
	}

	/**
	 * Verify and apply one Accounts v2 THIN event delivery (`/api/finance/webhooks/stripe-v2`). A thin
	 * event names the account and nothing else, so the account is re-read from Stripe and its current
	 * capability applied (`syncConnectAccount`) — idempotent by value, so a redelivery re-applies the
	 * truth rather than replaying a stale snapshot. Same status contract as {@link handleStripeWebhook}.
	 */
	static async handleStripeThinWebhook(
		payload: string,
		signature: string | null,
	): Promise<Result<StripeWebhookReceipt>> {
		const settings = liveSettings();
		if (!settings?.thinWebhookSecret) return notConnected("Stripe v2 webhooks aren't configured here.");
		if (!signature) return fail(400, { message: "Missing Stripe-Signature header." });

		let notification;
		try {
			notification = await getStripe().parseEventNotificationAsync(payload, signature, settings.thinWebhookSecret);
		} catch (error) {
			const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
			console.warn("[payments:webhook-v2] rejected delivery:", reason);
			return fail(400, { message: "Invalid Stripe signature." });
		}
		const n = notification as unknown as {
			id: string;
			type: string;
			livemode: boolean;
			related_object?: { id?: string; type?: string } | null;
		};
		const receipt = (outcome: StripeWebhookOutcome, detail: string | null): Result<StripeWebhookReceipt> =>
			ok({ received: true, eventId: n.id, type: n.type, outcome, detail });

		if (!isHandledStripeThinEvent(n.type)) return receipt("ignored", "event type not handled");
		if (n.livemode !== (settings.mode === "live")) {
			return receipt("ignored", `a ${n.livemode ? "live" : "test"}-mode event on a ${settings.mode}-mode deployment`);
		}
		const accountId = n.related_object?.id;
		if (!accountId || !/^acct_/.test(accountId)) return receipt("ignored", "the event names no account");
		try {
			const applied = await syncConnectAccount(accountId);
			return receipt(applied.outcome, applied.detail);
		} catch (error) {
			console.error("[payments:webhook-v2]", n.id, n.type, error instanceof Error ? error.message : error);
			return fail(500, { message: "The event could not be recorded; Stripe will retry it." });
		}
	}
	// #endregion
}
