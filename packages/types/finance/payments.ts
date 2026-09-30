import { z } from "zod";
import {
	currency,
	FinanceOwnerType,
	minorUnitsNonNeg,
	minorUnitsPositive,
	timestamp,
	uuid,
} from "./common.ts";
import { KycStatus } from "./verification.ts";
import { MoneyViewSchema } from "./wallet.ts";

/**
 * finance payments — the Stripe fiat rails, Phase 1 (root CLAUDE.md §8 Decision #125).
 *
 * Four capabilities cross the network boundary here, and every shape they carry is declared once:
 *
 * 1. **Money in.** A card payment is a Stripe PaymentIntent on the PLATFORM account whose settled funds
 *    land in a Projective wallet (`finance.inbound_payments`, the twin of `finance.payouts`). A payment
 *    either tops a wallet up, or funds a stage's escrow — the latter credits the paying business's
 *    wallet and then holds the escrow from it, because an escrow is always funded from a wallet
 *    (`finance.fn_hold_ticket_escrow`). The charge is never a destination charge: money that is held
 *    until approval, may be refunded, and may be split across a team must not be transferred to a
 *    connected account at the moment it is paid.
 * 2. **The payout account.** A Stripe Connect account (Accounts v2, Express dashboard, recipient
 *    configuration) recorded in `finance.payout_accounts`.
 * 3. **Identity.** A Stripe Identity verification session recorded as a `finance.verification_cases`
 *    row — the freelancer Level-2 KYC gate.
 * 4. **The webhook.** The signed event stream that settles all three.
 *
 * ⚠️ **No PII and no card data.** Every provider reference here is an opaque id (`pi_…`, `acct_…`,
 * `vs_…`, `tr_…`, `du_…`). A `clientSecret` travels to the owning browser to confirm ONE object with
 * Stripe.js and is never stored.
 */

// #region Shared vocabulary
/** Which Stripe environment answered. Test objects can never move real money. */
export const StripeMode = z.enum(["test", "live"]);
export type StripeMode = z.infer<typeof StripeMode>;

/** A client-minted key held for the life of ONE attempt, so a retry replays instead of re-charging. */
const attemptKey = z.string().min(8).max(120);

/** An opaque Stripe object id with a known prefix (`pi_…`, `acct_…`, `vs_…`). */
const stripeId = (prefix: string) =>
	z.string().max(255).regex(
		new RegExp(`^${prefix}_[A-Za-z0-9_]+$`),
		`Expected a Stripe ${prefix}_ id.`,
	);
// #endregion

// #region Inbound payments (finance.inbound_payments)
/** `finance.inbound_payments.purpose` — what the money that entered is FOR. */
export const InboundPaymentPurpose = z.enum(["wallet_topup", "escrow_lock"]);
export type InboundPaymentPurpose = z.infer<typeof InboundPaymentPurpose>;

/**
 * `finance.inbound_payment_status` — the lifecycle of money entering from an external instrument.
 * `succeeded` is written by the signed webhook ONLY: a browser's "payment confirmed" is a claim, the
 * `payment_intent.succeeded` event is the fact.
 */
export const InboundPaymentStatus = z.enum([
	"requires_payment",
	"processing",
	"succeeded",
	"failed",
	"canceled",
]);
export type InboundPaymentStatus = z.infer<typeof InboundPaymentStatus>;

/**
 * `finance.inbound_payments.lock_status` — for an `escrow_lock` payment, whether the settled money
 * could be held against the stage. `not_applicable` on every top-up. A `failed` lock never loses
 * money: the settled amount stays in the paying wallet, where the stage can be funded again.
 */
export const EscrowLockStatus = z.enum(["not_applicable", "pending", "locked", "failed"]);
export type EscrowLockStatus = z.infer<typeof EscrowLockStatus>;

/** A row of `finance.inbound_payments` — one attempt to move money INTO a wallet from outside. */
export const InboundPaymentSchema = z.object({
	id: uuid,
	purpose: InboundPaymentPurpose,
	walletId: uuid,
	projectStageId: uuid.nullable(),
	amountCents: minorUnitsPositive,
	currency,
	amountReceivedCents: minorUnitsNonNeg.nullable(),
	status: InboundPaymentStatus,
	lockStatus: EscrowLockStatus,
	lockError: z.string().max(400).nullable(),
	lockedEscrowIds: z.array(uuid),
	provider: z.string().max(60),
	/** The Stripe PaymentIntent id (placeholder `XXXX-XXXX` in docs). */
	providerRef: z.string().max(255).nullable(),
	idempotencyKey: attemptKey,
	transactionId: uuid.nullable(),
	failureReason: z.string().max(400).nullable(),
	livemode: z.boolean().nullable(),
	createdBy: uuid,
	/** The standing rule that charged this payment off-session, or null for a payment made in the moment. */
	depositRuleId: uuid.nullable().optional(),
	createdAt: timestamp,
	updatedAt: timestamp,
	succeededAt: timestamp.nullable(),
});
export type InboundPayment = z.infer<typeof InboundPaymentSchema>;

/**
 * Fund a stage's escrow by card — the One-Off "upfront" lock and the Pipeline "Buy Now" lock
 * (PRODUCT_SPEC §Escrow Lifetimes). The AMOUNT is computed by the database from the same columns the
 * escrow hold reads; `expectedAmountMinor` is only what the payer was SHOWN, compared with it so a
 * price that moved between showing and paying refuses instead of charging an amount nobody saw.
 */
export const CreateEscrowLockIntentSchema = z.object({
	projectId: uuid,
	stageId: uuid,
	expectedAmountMinor: minorUnitsPositive,
	currency,
	idempotencyKey: attemptKey,
});
export type CreateEscrowLockIntent = z.infer<typeof CreateEscrowLockIntentSchema>;

/** Top a wallet up by card. The wallet's own currency is the only currency it can be paid in. */
export const CreateTopUpIntentSchema = z.object({
	walletId: uuid,
	amountMinor: minorUnitsPositive,
	currency,
	idempotencyKey: attemptKey,
});
export type CreateTopUpIntent = z.infer<typeof CreateTopUpIntentSchema>;

/**
 * What the browser needs to confirm a card payment with Stripe.js (the Payment Element), and nothing
 * more. `amount` is in the payment's own currency — a charge is stated in the currency the card is
 * actually charged in, never re-converted for display.
 */
export const CardPaymentHandoffSchema = z.object({
	paymentId: uuid,
	purpose: InboundPaymentPurpose,
	status: InboundPaymentStatus,
	lockStatus: EscrowLockStatus,
	amount: MoneyViewSchema,
	providerRef: stripeId("pi"),
	/** Confirms THIS PaymentIntent from the owner's browser. Never stored, never logged. */
	clientSecret: z.string().min(1).max(500),
	publishableKey: z.string().max(255).nullable(),
	mode: StripeMode,
	/** True when this answer replays an earlier attempt with the same key. */
	replayed: z.boolean(),
	/**
	 * What the browser does next. `collect` — mount the Payment Element and take a card.
	 * `authenticate` — a SAVED card was charged and the bank asks its holder to confirm (3-D Secure):
	 * answer it with Stripe.js `handleNextAction`. `none` — a saved card was charged and there is
	 * nothing left to do but wait for the signed webhook to credit the wallet.
	 */
	confirmation: z.enum(["collect", "authenticate", "none"]).default("collect"),
});
export type CardPaymentHandoff = z.infer<typeof CardPaymentHandoffSchema>;
// #endregion

// #region Payout accounts — Stripe Connect (finance.payout_accounts)
/**
 * `finance.payout_accounts.status` — the Connect account's readiness to RECEIVE transfers, mapped from
 * the v2 recipient capability `stripe_balance.stripe_transfers` by {@link payoutAccountStatusFor}.
 */
export const PayoutAccountStatus = z.enum([
	"pending_verification",
	"verified",
	"restricted",
	"disabled",
]);
export type PayoutAccountStatus = z.infer<typeof PayoutAccountStatus>;

/** `finance.payout_accounts.owner_type` — the shared five-value finance owner axis. */
export const PayoutAccountOwnerType = FinanceOwnerType;
export type PayoutAccountOwnerType = FinanceOwnerType;

/** A row of `finance.payout_accounts` — a provider payout destination (a Stripe Connect account). */
export const PayoutAccountSchema = z.object({
	id: uuid,
	ownerType: PayoutAccountOwnerType,
	ownerId: uuid,
	provider: z.string().max(60),
	/** The Stripe connected-account id (placeholder `XXXX-XXXX` in docs). */
	accountId: z.string().max(255),
	status: PayoutAccountStatus,
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type PayoutAccount = z.infer<typeof PayoutAccountSchema>;

/**
 * `finance.payout_status` — the in-flight lifecycle of a withdrawal, member for member with the
 * Postgres enum (spelled `cancelled`, unlike the processor-facing `canceled` of
 * {@link InboundPaymentStatus}, because the column predates this module).
 */
export const PayoutStatus = z.enum(["pending", "paid", "failed", "cancelled"]);
export type PayoutStatus = z.infer<typeof PayoutStatus>;

/**
 * A row of `finance.payouts` — one attempt to move money OUT of a wallet, the twin of
 * {@link InboundPaymentSchema}. `providerRef` is the Stripe Transfer id the `transfer.created` webhook
 * binds; `transactionId` is the ledger debit, `null` while in flight and forever on a failure.
 */
export const PayoutSchema = z.object({
	id: uuid,
	walletId: uuid,
	destinationMethodId: uuid.nullable(),
	scheduleId: uuid.nullable(),
	amountCents: minorUnitsPositive,
	currency,
	status: PayoutStatus,
	instant: z.boolean(),
	provider: z.string().max(60),
	providerRef: z.string().max(255).nullable(),
	transactionId: uuid.nullable(),
	failureReason: z.string().max(400).nullable(),
	initiatedAt: timestamp,
	settledAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type Payout = z.infer<typeof PayoutSchema>;

/** The v2 capability status Stripe reports for `stripe_balance.stripe_transfers`. */
export const TransfersCapabilityStatus = z.enum(["active", "pending", "restricted", "unsupported"]);
export type TransfersCapabilityStatus = z.infer<typeof TransfersCapabilityStatus>;

/**
 * Map the v2 recipient capability onto the stored account status. `null` — Stripe has not reported
 * the capability yet (a just-created account) — is `pending_verification`, never `verified`: an
 * account is payable only once Stripe says transfers are active.
 */
export function payoutAccountStatusFor(
	capability: TransfersCapabilityStatus | null,
): PayoutAccountStatus {
	switch (capability) {
		case "active":
			return "verified";
		case "restricted":
			return "restricted";
		case "unsupported":
			return "disabled";
		default:
			return "pending_verification";
	}
}

/**
 * Whose payout account a request is about: the caller's own, a team's, or a client business's (both
 * need `manage_billing`). A business's Connect onboarding is its Level-3 KYB check — a verified account
 * is mirrored onto `org.business_profiles.kyb_status` by `finance.sync_payout_account`.
 */
export const PayoutAccountScopeKind = z.enum(["personal", "team", "business"]);
export type PayoutAccountScopeKind = z.infer<typeof PayoutAccountScopeKind>;

/** The entity a shared scope names, or `null` for a personal one. */
export function payoutEntityId(
	owner: { scope: PayoutAccountScopeKind; teamId?: string | null; businessId?: string | null },
): string | null {
	if (owner.scope === "team") return owner.teamId ?? null;
	if (owner.scope === "business") return owner.businessId ?? null;
	return null;
}

const scopeRefinement = <T extends { scope: PayoutAccountScopeKind; teamId?: string | null; businessId?: string | null }>(
	schema: z.ZodType<T>,
) =>
	schema
		.refine((input) => input.scope !== "team" || typeof input.teamId === "string", {
			message: "Choose the team whose payout account this is.",
			path: ["teamId"],
		})
		.refine((input) => input.scope !== "business" || typeof input.businessId === "string", {
			message: "Choose the business to verify.",
			path: ["businessId"],
		});

/** The surface a Stripe-hosted onboarding flow returns to. */
export const OnboardingReturn = z.enum(["wallet", "settings"]);
export type OnboardingReturn = z.infer<typeof OnboardingReturn>;

/** The page a return lands on — the business KYB check always belongs to the settings page. */
export function onboardingReturnPath(
	owner: { scope: PayoutAccountScopeKind },
	back: OnboardingReturn | null | undefined,
): string {
	return owner.scope === "business" || back === "settings" ? "/settings/verification" : "/wallet";
}

export const PayoutAccountScopeSchema = scopeRefinement(z.object({
	scope: PayoutAccountScopeKind,
	teamId: uuid.nullable().optional(),
	businessId: uuid.nullable().optional(),
}));
export type PayoutAccountScope = z.infer<typeof PayoutAccountScopeSchema>;

/**
 * Start (or resume) Stripe-hosted payout onboarding. `country` is the ISO 3166-1 alpha-2 country the
 * payouts are FOR — asked explicitly rather than inferred, because the processor fixes an account's
 * country at creation and it can never be changed afterwards (and profiles store a free-text country
 * name, not a code). Ignored when the owner already holds an account.
 */
export const ConnectOnboardingInputSchema = scopeRefinement(z.object({
	scope: PayoutAccountScopeKind,
	teamId: uuid.nullable().optional(),
	businessId: uuid.nullable().optional(),
	country: z.string({ error: "Choose the country your payouts are for." })
		.regex(/^[A-Za-z]{2}$/, "Choose the country your payouts are for."),
	/** Where Stripe's hosted flow lands the person afterwards: the wallet (default) or the settings page. */
	returnTo: OnboardingReturn.optional(),
}));
export type ConnectOnboardingInput = z.infer<typeof ConnectOnboardingInputSchema>;

/**
 * Start the Level-3 KYB check for a client business (`POST /api/finance/verify/kyb`): Stripe Connect
 * onboarding for the business's own account, which collects and verifies the company's details.
 */
export const KybOnboardingInputSchema = z.object({
	businessId: uuid,
	country: z.string({ error: "Choose the country the business is registered in." })
		.regex(/^[A-Za-z]{2}$/, "Choose the country the business is registered in."),
});
export type KybOnboardingInput = z.infer<typeof KybOnboardingInputSchema>;

/** Where a payout account stands, as the owner may see it. */
export const ConnectAccountStatusSchema = z.object({
	ownerType: PayoutAccountOwnerType,
	ownerId: uuid,
	/** `null` until onboarding has created the connected account. */
	accountId: z.string().max(255).nullable(),
	status: z.union([PayoutAccountStatus, z.literal("not_started")]),
	/** The raw capability Stripe last reported, when this answer came from Stripe. */
	transfersCapability: TransfersCapabilityStatus.nullable(),
	/**
	 * Whether money can be paid out to this owner — for a freelancer, the `payout_ready` half of the
	 * earning gate (`finance.fn_freelancer_payout_ready` also requires KYC).
	 */
	payoutReady: z.boolean(),
});
export type ConnectAccountStatus = z.infer<typeof ConnectAccountStatusSchema>;

/** A single-use Stripe-hosted onboarding link plus the account it onboards. */
export const ConnectOnboardingLinkSchema = z.object({
	url: z.string().url().max(2000),
	expiresAt: timestamp,
	account: ConnectAccountStatusSchema,
});
export type ConnectOnboardingLink = z.infer<typeof ConnectOnboardingLinkSchema>;
// #endregion

// #region Identity (finance.verification_cases, provider stripe_identity)
/**
 * What the browser needs to run a Stripe Identity check: the hosted `url` (redirect flow) and the
 * `clientSecret` (Stripe.js modal flow) — either works. Neither is stored.
 */
export const IdentitySessionHandoffSchema = z.object({
	caseId: uuid,
	status: KycStatus,
	/** The verification session id (placeholder `XXXX-XXXX` in docs). */
	providerRef: stripeId("vs"),
	url: z.string().url().max(2000).nullable(),
	clientSecret: z.string().max(500).nullable(),
	publishableKey: z.string().max(255).nullable(),
	mode: StripeMode,
});
export type IdentitySessionHandoff = z.infer<typeof IdentitySessionHandoffSchema>;

/** One client business in the verification picture, and whether the caller may start its KYB. */
export const BusinessVerificationEntrySchema = z.object({
	id: uuid,
	name: z.string().max(200),
	kybStatus: KycStatus,
	kybVerifiedAt: timestamp.nullable(),
	/** `manage_billing` on the business — only such a member may start or resume its check. */
	canManage: z.boolean(),
});
export type BusinessVerificationEntry = z.infer<typeof BusinessVerificationEntrySchema>;

/**
 * The caller's whole verification picture (`GET /api/finance/verify/status`, read by
 * `/settings/verification`): their own Level-2 KYC, their personal payout account, and the Level-3 KYB
 * of every client business they belong to. Statuses only — no document, no provider reference.
 */
export const VerificationStatusSchema = z.object({
	isFreelancer: z.boolean(),
	kycStatus: KycStatus,
	kycTier: z.number().int().min(1).max(3).nullable(),
	payoutReady: z.boolean(),
	/** The latest identity case, when there is one. */
	latestCase: z.object({
		status: KycStatus,
		createdAt: timestamp,
		decidedAt: timestamp.nullable(),
	}).nullable(),
	/** The personal Connect payout account — `null` when payments are not connected here. */
	payoutAccount: ConnectAccountStatusSchema.nullable(),
	businesses: z.array(BusinessVerificationEntrySchema),
	/** False when the processor is not connected in this environment: every start control is locked. */
	processorConnected: z.boolean(),
});
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
// #endregion

// #region Saved cards (SetupIntent → finance.payment_methods + finance.saved_cards)
/** Whose card is being saved: the caller's own, or a team/business they manage billing for. */
export const CardOwnerScope = z.enum(["personal", "team", "business"]);
export type CardOwnerScope = z.infer<typeof CardOwnerScope>;

/** Start saving a card (`POST /api/finance/cards/setup`). */
export const CreateCardSetupSchema = z.object({
	scope: CardOwnerScope,
	/** The team/business id; ignored for `personal`. */
	contextId: z.string().max(64).nullable().optional(),
});
export type CreateCardSetup = z.infer<typeof CreateCardSetupSchema>;

/**
 * What the browser needs to collect a card with the Payment Element in `setup` mode. The card number
 * goes from the Element straight to Stripe; Projective only ever sees the resulting `pm_…` id.
 */
export const CardSetupHandoffSchema = z.object({
	setupIntentId: stripeId("seti"),
	clientSecret: z.string().min(1).max(500),
	publishableKey: z.string().max(255).nullable(),
	mode: StripeMode,
	scope: CardOwnerScope,
	contextId: z.string().max(64).nullable(),
});
export type CardSetupHandoff = z.infer<typeof CardSetupHandoffSchema>;

/** Record the card a confirmed SetupIntent saved (`POST /api/finance/cards/confirm`). */
export const ConfirmCardSetupSchema = z.object({
	setupIntentId: stripeId("seti"),
	scope: CardOwnerScope,
	contextId: z.string().max(64).nullable().optional(),
	makeDefault: z.boolean().optional(),
});
export type ConfirmCardSetup = z.infer<typeof ConfirmCardSetupSchema>;

/** The saved card, as its display projection — never anything that could charge it. */
export const SavedCardResultSchema = z.object({
	methodId: uuid,
	cardId: uuid,
	brand: z.string().max(40),
	last4: z.string().regex(/^[0-9]{4}$/).nullable(),
	expMonth: z.number().int().min(1).max(12).nullable(),
	expYear: z.number().int().nullable(),
	isDefault: z.boolean(),
});
export type SavedCardResult = z.infer<typeof SavedCardResultSchema>;
// #endregion

// #region Withdrawals (finance.payouts → Stripe Transfer)
/**
 * A withdrawal's outcome: the payout row, the connected account it went to, and whether this call
 * replayed an earlier attempt. `payout.status` is `paid` once the Transfer exists (the money has left
 * Projective for the owner's Stripe account, which pays their bank on its own schedule), `failed` when
 * Stripe refused (the money is back in the wallet), `pending` only while the answer is unknown.
 */
export const PayoutResultSchema = z.object({
	payout: PayoutSchema,
	destination: z.string().max(255).nullable(),
	replayed: z.boolean(),
});
export type PayoutResult = z.infer<typeof PayoutResultSchema>;
// #endregion

// #region Card-backed wallet actions
/**
 * The extra an action that needs the card in the browser answers with, beside the refreshed overview:
 * a PaymentIntent to confirm (Top up) or a SetupIntent to confirm (Add card). Declared here, not in
 * wallet.ts, because this module already depends on wallet.ts and the reverse would be a cycle.
 */
export const WalletCardHandoffSchema = z.object({
	payment: CardPaymentHandoffSchema.optional(),
	setup: CardSetupHandoffSchema.optional(),
	payout: PayoutResultSchema.optional(),
});
export type WalletCardHandoff = z.infer<typeof WalletCardHandoffSchema>;

/**
 * The Income Smoother fee on a smoothed amount: `income_smoother_fee_bp` of it, floored — the rule the
 * enrolment dialog previews. Pure, and the only implementation; the smoothing disbursement that will
 * charge it is not built yet (Decision #126), so nothing deducts it today.
 */
export function incomeSmootherFeeMinor(amountMinor: number, feeBp: number): number {
	if (!Number.isFinite(amountMinor) || amountMinor <= 0 || !Number.isFinite(feeBp) || feeBp <= 0) return 0;
	return Math.floor((Math.trunc(amountMinor) * Math.trunc(feeBp)) / 10000);
}
// #endregion

// #region Webhooks
/**
 * Every Stripe event type the webhook ACTS on. The four the architecture names (succeeded,
 * verified, transfer created, dispute created) plus the failure halves of the same two lifecycles —
 * without them a declined card or a failed ID check would sit at "pending" forever. Every other type
 * is acknowledged and ignored.
 */
export const HANDLED_STRIPE_EVENTS = [
	"payment_intent.succeeded",
	"payment_intent.payment_failed",
	"payment_intent.canceled",
	"identity.verification_session.verified",
	"identity.verification_session.requires_input",
	"identity.verification_session.canceled",
	"transfer.created",
	"charge.dispute.created",
	// Decision #126: the dispute's outcome, a Connect account's status change (v1 snapshot event; the
	// v2 thin `v2.core.account[configuration.recipient].capability_status_updated` arrives on its own
	// endpoint — see HANDLED_STRIPE_THIN_EVENTS), and a card a SetupIntent saved.
	"charge.dispute.closed",
	"account.updated",
	"setup_intent.succeeded",
] as const;
export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

/** Whether the webhook acts on an event type. */
export function isHandledStripeEvent(type: string): type is HandledStripeEvent {
	return (HANDLED_STRIPE_EVENTS as readonly string[]).includes(type);
}

/**
 * The Accounts v2 THIN events the second endpoint (`/api/finance/webhooks/stripe-v2`) acts on. A thin
 * event carries only the related object's id, never its state, so the handler re-reads the account
 * from Stripe before applying anything — the same rule the snapshot `account.updated` follows.
 */
export const HANDLED_STRIPE_THIN_EVENTS = [
	"v2.core.account[configuration.recipient].capability_status_updated",
	"v2.core.account.updated",
] as const;
export type HandledStripeThinEvent = (typeof HANDLED_STRIPE_THIN_EVENTS)[number];

/** Whether the v2 endpoint acts on a thin event type. */
export function isHandledStripeThinEvent(type: string): type is HandledStripeThinEvent {
	return (HANDLED_STRIPE_THIN_EVENTS as readonly string[]).includes(type);
}

/**
 * What one delivery did: `applied` (the ledger/caches changed), `replayed` (this event id was already
 * processed — nothing changed twice), `unmatched` (a genuine event about an object Projective did not
 * create — recorded for reconciliation, nothing moved), `ignored` (a type this endpoint does not act
 * on, or an event from the other Stripe mode).
 */
export const StripeWebhookOutcome = z.enum(["applied", "replayed", "unmatched", "ignored"]);
export type StripeWebhookOutcome = z.infer<typeof StripeWebhookOutcome>;

/** The webhook's answer body. Stripe reads only the status; this is for the logs and the tests. */
export const StripeWebhookReceiptSchema = z.object({
	received: z.literal(true),
	eventId: z.string().max(255),
	type: z.string().max(120),
	outcome: StripeWebhookOutcome,
	detail: z.string().max(200).nullable(),
});
export type StripeWebhookReceipt = z.infer<typeof StripeWebhookReceiptSchema>;
// #endregion
