import {
	type CardOwnerScope,
	type CheckoutOrderLink,
	type InboundPayment,
	InboundPaymentSchema,
	KycStatus,
	type Payout,
	type PayoutAccount,
	PayoutAccountSchema,
	type PayoutAccountScope,
	type PayoutAccountStatus,
	payoutEntityId,
	PayoutSchema,
	type SavedCardResult,
	SavedCardResultSchema,
	type VerificationCase,
	VerificationCaseSchema,
} from "@projective/types/finance";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import type { FieldErrors } from "../ServiceResult.ts";

/**
 * live-payments — the DATABASE half of the Stripe fiat rails: one typed wrapper per door in
 * `supabase/migrations/00001230_functions_finance_stripe.sql`, and the row mapping that turns what
 * those doors return into the Zod SSOT shapes.
 *
 * Two clients, matching the two kinds of door:
 *
 * - **User doors** run through {@link getUserClient} with the caller's own token, so `auth.uid()` is
 *   the person asking and the definer authorises THEM. A refusal comes back as a {@link DbRefusal}
 *   the fat service answers with — it is an answer, not an error.
 * - **Processor doors** run through {@link getServiceClient}, because they apply what Stripe reported
 *   and no user may call them. Any failure there THROWS: the webhook must answer 5xx so Stripe
 *   redelivers, and a status read must not pretend it recorded something it did not.
 *
 * Every row a door returns is parsed through its Zod schema on the way out, so a column the database
 * and the SSOT disagree about fails loudly here instead of reaching a surface as `undefined`.
 */

// #region Refusals
/** A database refusal, already shaped for a `ServiceResult`. */
export interface DbRefusal {
	status: number;
	message: string;
	errors?: FieldErrors;
}

/** Either the value a door returned, or the refusal it raised. */
export type DbResult<T> = { ok: true; value: T } | { ok: false; refusal: DbRefusal };

/** The request fields a door may prefix a refusal with (`<field>: <reason>`). */
const FIELD_PREFIXES: ReadonlySet<string> = new Set([
	"walletId",
	"stageId",
	"amountMinor",
	"expectedAmountMinor",
	"currency",
	"idempotencyKey",
	"teamId",
	"businessId",
	"contextId",
	"country",
	"accountId",
	"destinationId",
	"sourceMethodId",
	"interval",
	"targetMonthlyMinor",
]);

/**
 * The HTTP status a refusal's SQLSTATE maps to. `42501` covers two different answers: "sign in …"
 * (the door saw no identity at all — 401) and every other authority refusal ("not you" — 403).
 */
function statusForCode(code: string | undefined, reason: string): number {
	switch (code) {
		case "42501":
			return /^sign in\b/i.test(reason) ? 401 : 403;
		case "PK403":
		case "PA403":
			return 403;
		case "PF402":
			return 402;
		case "P0002":
			return 404;
		case "PX409":
		case "PC409":
			return 409;
		case "PR429":
			return 429;
		case "PS501":
		case "22023":
			return 422;
		default:
			return 500;
	}
}

/**
 * Shape a door's refusal. The doors raise `"<field>: <reason>"`; a known request field becomes a
 * field error, anything else (`auth`, `payment`, `identity`) a plain message. A SQLSTATE this layer
 * does not recognise is NOT a sentence for a reader: it is reported generically and logged.
 */
export function refusalOf(error: { code?: string; message: string }, label: string): DbRefusal {
	const match = /^([A-Za-z]+):\s*([\s\S]+)$/.exec(error.message.trim());
	const prefix = match ? match[1] : null;
	const raw = (match ? match[2] : error.message).replace(/\s+/g, " ").trim();
	const reason = raw
		? `${raw[0].toUpperCase()}${raw.slice(1)}${/[.!?]$/.test(raw) ? "" : "."}`
		: raw;
	const status = statusForCode(error.code, raw);
	if (status === 500) {
		console.error(`[payments:${label}]`, error.code, error.message);
		return { status: 500, message: "That didn't go through. Try again in a moment." };
	}
	const errors = prefix && FIELD_PREFIXES.has(prefix) ? { [prefix]: reason } : undefined;
	return { status, message: reason.slice(0, 300), errors };
}
// #endregion

// #region Row mapping
type Row = Record<string, unknown>;

function num(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/** Map a `finance.inbound_payments` row (as `to_jsonb` returns it) onto the SSOT shape. */
export function inboundPaymentOf(row: Row): InboundPayment {
	return InboundPaymentSchema.parse({
		id: row.id,
		purpose: row.purpose,
		walletId: row.wallet_id,
		projectStageId: row.project_stage_id ?? null,
		amountCents: num(row.amount_cents),
		currency: row.currency,
		amountReceivedCents: num(row.amount_received_cents),
		status: row.status,
		lockStatus: row.lock_status,
		lockError: row.lock_error ?? null,
		lockedEscrowIds: Array.isArray(row.locked_escrow_ids) ? row.locked_escrow_ids : [],
		provider: row.provider,
		providerRef: row.provider_ref ?? null,
		idempotencyKey: row.idempotency_key,
		transactionId: row.transaction_id ?? null,
		failureReason: row.failure_reason ?? null,
		livemode: typeof row.livemode === "boolean" ? row.livemode : null,
		createdBy: row.created_by,
		depositRuleId: row.deposit_rule_id ?? null,
		checkout: checkoutLinkOf(row.checkout),
		orderId: row.order_id ?? null,
		orderError: row.order_error ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		succeededAt: row.succeeded_at ?? null,
	});
}

/** Map the stored `checkout` jsonb (snake_case) onto {@link CheckoutOrderLink}; `null` when absent. */
function checkoutLinkOf(raw: unknown): CheckoutOrderLink | null {
	if (typeof raw !== "object" || raw === null) return null;
	const link = raw as Row;
	return {
		basketId: String(link.basket_id),
		itemIds: Array.isArray(link.item_ids) ? link.item_ids.map(String) : [],
		currency: String(link.currency),
		units: (typeof link.units === "object" && link.units !== null ? link.units : {}) as Record<string, number>,
		promoCode: typeof link.promo_code === "string" ? link.promo_code : null,
		orderKey: String(link.order_key),
	};
}

/** Map a `finance.payout_accounts` row onto the SSOT shape. */
export function payoutAccountOf(row: Row): PayoutAccount {
	return PayoutAccountSchema.parse({
		id: row.id,
		ownerType: row.owner_type,
		ownerId: row.owner_id,
		provider: row.provider,
		accountId: row.account_id,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

/** Map a `finance.verification_cases` row onto the SSOT shape. */
export function verificationCaseOf(row: Row): VerificationCase {
	return VerificationCaseSchema.parse({
		id: row.id,
		subjectType: row.subject_type,
		subjectId: row.subject_id,
		kind: row.kind,
		status: row.status,
		tier: num(row.tier),
		provider: row.provider,
		providerRef: row.provider_ref ?? null,
		submittedAt: row.submitted_at ?? null,
		decidedAt: row.decided_at ?? null,
		notes: row.notes ?? null,
		createdAt: row.created_at,
	});
}
// #endregion

// #region User doors (the caller's own token)
async function userRpc<T>(
	accessToken: string,
	fn: string,
	args: Record<string, unknown>,
	map: (row: Row) => T,
): Promise<DbResult<T>> {
	const { data, error } = await getUserClient(accessToken).schema("finance").rpc(fn, args);
	if (error) return { ok: false, refusal: refusalOf(error, fn) };
	return { ok: true, value: map(data as Row) };
}

/** What `finance.begin_card_payment` answers: the attempt, and whether this call replayed it. */
export interface BegunPayment {
	payment: InboundPayment;
	replayed: boolean;
}

/** Start a card payment (`finance.begin_card_payment`). */
export function beginCardPayment(
	accessToken: string,
	args: {
		purpose: InboundPayment["purpose"];
		walletId: string | null;
		projectId: string | null;
		stageId: string | null;
		expectedAmountMinor: number;
		currency: string;
		idempotencyKey: string;
	},
): Promise<DbResult<BegunPayment>> {
	return userRpc(accessToken, "begin_card_payment", {
		p_purpose: args.purpose,
		p_wallet_id: args.walletId,
		p_project_id: args.projectId,
		p_stage_id: args.stageId,
		p_expected_amount: args.expectedAmountMinor,
		p_currency: args.currency,
		p_idempotency_key: args.idempotencyKey,
	}, (row) => ({ payment: inboundPaymentOf(row), replayed: row.replayed === true }));
}

/** Bind a started payment to its PaymentIntent (`finance.attach_card_payment`). */
export function attachCardPayment(
	accessToken: string,
	paymentId: string,
	providerRef: string,
): Promise<DbResult<InboundPayment>> {
	return userRpc(accessToken, "attach_card_payment", {
		p_payment_id: paymentId,
		p_provider_ref: providerRef,
	}, inboundPaymentOf);
}

/**
 * Name the checkout a started card / express top-up pays for (`finance.attach_checkout_order`,
 * Decision #153), so the settling webhook can place the order as the payer.
 *
 * `value: null` means the DATABASE predates the door (PostgREST `PGRST202` — no such function): the
 * payment goes ahead without the server-side backstop, exactly as before it existed, because the
 * browser still places the order itself under the same key. Any other answer is the door's own
 * refusal and is returned as one.
 */
export async function attachCheckoutOrder(
	accessToken: string,
	paymentId: string,
	link: CheckoutOrderLink,
): Promise<DbResult<InboundPayment | null>> {
	const { data, error } = await getUserClient(accessToken).schema("finance").rpc("attach_checkout_order", {
		p_payment_id: paymentId,
		p_checkout: {
			basket_id: link.basketId,
			item_ids: link.itemIds,
			currency: link.currency,
			units: link.units,
			promo_code: link.promoCode,
			order_key: link.orderKey,
		},
	});
	if (error) {
		if (error.code === "PGRST202") {
			console.warn("[payments:attach_checkout_order] not deployed — no server-side order backstop for", paymentId);
			return { ok: true, value: null };
		}
		return { ok: false, refusal: refusalOf(error, "attach_checkout_order") };
	}
	return { ok: true, value: inboundPaymentOf(data as Row) };
}

/** Give up on a payment the processor refused to create (`finance.abandon_card_payment`). */
export function abandonCardPayment(
	accessToken: string,
	paymentId: string,
	reason: string,
): Promise<DbResult<InboundPayment>> {
	return userRpc(accessToken, "abandon_card_payment", {
		p_payment_id: paymentId,
		p_reason: reason.slice(0, 400),
	}, inboundPaymentOf);
}

/** Open a KYC case for the calling freelancer (`finance.begin_identity_verification`). */
export function beginIdentityVerification(
	accessToken: string,
): Promise<DbResult<VerificationCase>> {
	return userRpc(accessToken, "begin_identity_verification", {}, verificationCaseOf);
}

/** Bind a case to its verification session (`finance.attach_identity_session`). */
export function attachIdentitySession(
	accessToken: string,
	caseId: string,
	sessionRef: string,
): Promise<DbResult<VerificationCase>> {
	return userRpc(accessToken, "attach_identity_session", {
		p_case_id: caseId,
		p_session_ref: sessionRef,
	}, verificationCaseOf);
}

/** Close a case the processor refused to open a session for (`finance.abandon_identity_verification`). */
export function abandonIdentityVerification(
	accessToken: string,
	caseId: string,
	note: string,
): Promise<DbResult<VerificationCase>> {
	return userRpc(accessToken, "abandon_identity_verification", {
		p_case_id: caseId,
		p_note: note.slice(0, 400),
	}, verificationCaseOf);
}

/** Whose payout account a request is about, and what it currently holds (`finance.payout_account_for`). */
export interface PayoutAccountLookup {
	ownerType: PayoutAccount["ownerType"];
	ownerId: string;
	displayName: string;
	/** The caller's own sign-in address, for Stripe's required account contact. Never stored. */
	contactEmail: string | null;
	account: PayoutAccount | null;
	payoutReady: boolean;
}

/** Look up the caller's (or their team's) Stripe payout account. */
export function payoutAccountFor(
	accessToken: string,
	owner: PayoutAccountScope,
): Promise<DbResult<PayoutAccountLookup>> {
	return userRpc(accessToken, "payout_account_for", {
		p_scope: owner.scope,
		p_team_id: payoutEntityId(owner),
	}, (row) => ({
		ownerType: PayoutAccountSchema.shape.ownerType.parse(row.owner_type),
		ownerId: String(row.owner_id),
		displayName: typeof row.display_name === "string" ? row.display_name : "",
		contactEmail: typeof row.contact_email === "string" && row.contact_email.includes("@")
			? row.contact_email
			: null,
		account: row.account && typeof row.account === "object"
			? payoutAccountOf(row.account as Row)
			: null,
		payoutReady: row.payout_ready === true,
	}));
}

/** Record the connected account created for the owner (`finance.record_payout_account`). */
export function recordPayoutAccount(
	accessToken: string,
	owner: PayoutAccountScope,
	accountId: string,
): Promise<DbResult<PayoutAccount>> {
	return userRpc(accessToken, "record_payout_account", {
		p_scope: owner.scope,
		p_team_id: payoutEntityId(owner),
		p_account_id: accountId,
	}, payoutAccountOf);
}

/** Map a `finance.payouts` row onto the SSOT shape. */
export function payoutOf(row: Row): Payout {
	return PayoutSchema.parse({
		id: row.id,
		walletId: row.wallet_id,
		destinationMethodId: row.destination_method_id ?? null,
		scheduleId: row.schedule_id ?? null,
		amountCents: num(row.amount_cents),
		currency: row.currency,
		status: row.status,
		instant: row.instant === true,
		provider: row.provider,
		providerRef: row.provider_ref ?? null,
		transactionId: row.transaction_id ?? null,
		failureReason: row.failure_reason ?? null,
		initiatedAt: row.initiated_at,
		settledAt: row.settled_at ?? null,
		createdAt: row.created_at,
	});
}

/** What `finance.begin_payout` answers: the debited payout, where it goes, and whether it replayed. */
export interface BegunPayout {
	payout: Payout;
	destination: string | null;
	replayed: boolean;
}

/** Start a withdrawal (`finance.begin_payout`) — debits the wallet at once. */
export function beginPayout(
	accessToken: string,
	args: { walletId: string; amountMinor: number; currency: string; instant: boolean; idempotencyKey: string },
): Promise<DbResult<BegunPayout>> {
	return userRpc(accessToken, "begin_payout", {
		p_wallet_id: args.walletId,
		p_amount: args.amountMinor,
		p_currency: args.currency,
		p_instant: args.instant,
		p_idempotency_key: args.idempotencyKey,
	}, (row) => ({
		payout: payoutOf(row),
		destination: typeof row.destination === "string" ? row.destination : null,
		replayed: row.replayed === true,
	}));
}

/** Whose card is being saved and the Customer it attaches to (`finance.card_owner_for`). */
export interface CardOwnerLookup {
	ownerType: string;
	ownerId: string;
	customerRef: string | null;
	contactEmail: string | null;
	displayName: string;
}

function cardOwnerOf(row: Row): CardOwnerLookup {
	return {
		ownerType: String(row.owner_type),
		ownerId: String(row.owner_id),
		customerRef: typeof row.customer_ref === "string" ? row.customer_ref : null,
		contactEmail: typeof row.contact_email === "string" && row.contact_email.includes("@")
			? row.contact_email
			: null,
		displayName: typeof row.display_name === "string" ? row.display_name : "",
	};
}

/** Resolve (and authorise) the owner a card is saved for. */
export function cardOwnerFor(
	accessToken: string,
	scope: CardOwnerScope,
	contextId: string | null,
): Promise<DbResult<CardOwnerLookup>> {
	return userRpc(accessToken, "card_owner_for", {
		p_scope: scope,
		p_entity_id: scope === "personal" ? null : contextId,
	}, cardOwnerOf);
}

/** Record the Customer created for an owner (`finance.record_processor_customer`) — the winner returns. */
export function recordProcessorCustomer(
	accessToken: string,
	scope: CardOwnerScope,
	contextId: string | null,
	customerRef: string,
): Promise<DbResult<string>> {
	return userRpc(accessToken, "record_processor_customer", {
		p_scope: scope,
		p_entity_id: scope === "personal" ? null : contextId,
		p_customer_ref: customerRef,
	}, (row) => String(row.customer_ref));
}

/** Create a standing top-up (`finance.create_deposit_rule`); `created_by` is stamped by the database. */
export function createDepositRule(
	accessToken: string,
	args: {
		walletId: string;
		amountMinor: number;
		currency: string;
		interval: "weekly" | "monthly";
		sourceMethodId: string;
	},
): Promise<DbResult<{ id: string; nextRunAt: string }>> {
	return userRpc(accessToken, "create_deposit_rule", {
		p_wallet_id: args.walletId,
		p_amount: args.amountMinor,
		p_currency: args.currency,
		p_interval: args.interval,
		p_source_method_id: args.sourceMethodId,
	}, (row) => ({ id: String(row.id), nextRunAt: String(row.next_run_at) }));
}

/** Enrol in or leave the Income Smoother (`finance.set_income_smoother`). */
export function setIncomeSmoother(
	accessToken: string,
	args: { currency: string; targetMonthlyMinor: number; enrol: boolean },
): Promise<DbResult<{ enrolled: boolean; feeBp: number | null }>> {
	return userRpc(accessToken, "set_income_smoother", {
		p_currency: args.currency,
		p_target_monthly_cents: args.targetMonthlyMinor,
		p_enrol: args.enrol,
	}, (row) => ({ enrolled: row.enrolled === true, feeBp: num(row.fee_bp) }));
}

/** The wallet a card checkout tops up before paying from it (`finance.ensure_purchase_wallet`). */
export function ensurePurchaseWallet(
	accessToken: string,
	ownerType: string,
	ownerId: string,
	currency: string,
): Promise<DbResult<string>> {
	return userRpc(accessToken, "ensure_purchase_wallet", {
		p_owner_type: ownerType,
		p_owner_id: ownerId,
		p_currency: currency,
	}, (row) => String(row));
}

/**
 * One inbound payment as the caller may see it — RLS (`View visible inbound payments`) admits the
 * readers of its wallet. `null` when it does not exist or is not theirs to see.
 */
export async function readInboundPayment(accessToken: string, paymentId: string): Promise<InboundPayment | null> {
	const { data, error } = await getUserClient(accessToken).schema("finance").from("inbound_payments")
		.select("*").eq("id", paymentId).maybeSingle();
	if (error) throw new Error(`finance.inbound_payments read failed: ${error.message}`);
	return data ? inboundPaymentOf(data as Row) : null;
}

/** The caller's raw verification picture (`finance.my_verification_status`). */
export interface VerificationStatusRow {
	isFreelancer: boolean;
	kycStatus: KycStatus;
	kycTier: number | null;
	payoutReady: boolean;
	latestCase: { status: KycStatus; createdAt: string; decidedAt: string | null } | null;
	businesses: {
		id: string;
		name: string;
		kybStatus: KycStatus;
		kybVerifiedAt: string | null;
		canManage: boolean;
	}[];
}

/** Read the caller's own verification picture. */
export function myVerificationStatus(accessToken: string): Promise<DbResult<VerificationStatusRow>> {
	return userRpc(accessToken, "my_verification_status", {}, (row) => {
		const kyc = KycStatus.safeParse(row.kyc_status);
		const tier = num(row.kyc_tier);
		const latest = row.latest_case && typeof row.latest_case === "object" ? row.latest_case as Row : null;
		const latestStatus = latest ? KycStatus.safeParse(latest.status) : null;
		return {
			isFreelancer: row.is_freelancer === true,
			kycStatus: kyc.success ? kyc.data : "unverified",
			kycTier: tier === 1 || tier === 2 || tier === 3 ? tier : null,
			payoutReady: row.payout_ready === true,
			latestCase: latest && latestStatus?.success
				? {
					status: latestStatus.data,
					createdAt: String(latest.created_at),
					decidedAt: typeof latest.decided_at === "string" ? latest.decided_at : null,
				}
				: null,
			businesses: (Array.isArray(row.businesses) ? row.businesses as Row[] : []).map((b) => {
				const kyb = KycStatus.safeParse(b.kyb_status);
				return {
					id: String(b.id),
					name: String(b.name ?? ""),
					kybStatus: kyb.success ? kyb.data : "unverified",
					kybVerifiedAt: typeof b.kyb_verified_at === "string" ? b.kyb_verified_at : null,
					canManage: b.can_manage === true,
				};
			}),
		};
	});
}
// #endregion

// #region Processor doors (service role — throw on any failure)
async function serviceRpc(fn: string, args: Record<string, unknown>): Promise<Row> {
	const { data, error } = await getServiceClient().schema("finance").rpc(fn, args);
	if (error) {
		throw new Error(`finance.${fn} failed (${error.code ?? "no code"}): ${error.message}`);
	}
	return (data ?? {}) as Row;
}

/** Apply the account status Stripe reported (`finance.sync_payout_account`). */
export async function syncPayoutAccount(
	accountId: string,
	status: PayoutAccountStatus,
): Promise<{ account: PayoutAccount; payoutReady: boolean }> {
	const row = await serviceRpc("sync_payout_account", {
		p_account_id: accountId,
		p_status: status,
	});
	return { account: payoutAccountOf(row.account as Row), payoutReady: row.payout_ready === true };
}

/** What a processor door did with one event — the `outcome` it stored on the event's claim. */
export interface EventOutcome {
	outcome: "applied" | "replayed" | "unmatched" | "ignored";
	detail: string | null;
	raw: Row;
}

function outcomeOf(row: Row): EventOutcome {
	const outcome = row.outcome;
	if (
		outcome !== "applied" && outcome !== "replayed" && outcome !== "unmatched" &&
		outcome !== "ignored"
	) {
		throw new Error(`unexpected webhook outcome: ${String(outcome)}`);
	}
	return { outcome, detail: typeof row.detail === "string" ? row.detail : null, raw: row };
}

/** `payment_intent.succeeded` → `finance.settle_card_payment`. */
export async function settleCardPayment(args: {
	eventId: string;
	paymentIntent: string;
	amountReceived: number;
	currency: string;
	livemode: boolean;
}): Promise<EventOutcome> {
	return outcomeOf(
		await serviceRpc("settle_card_payment", {
			p_event_id: args.eventId,
			p_provider_ref: args.paymentIntent,
			p_amount_received: args.amountReceived,
			p_currency: args.currency,
			p_livemode: args.livemode,
		}),
	);
}

/** `payment_intent.payment_failed` / `.canceled` → `finance.record_card_payment_failure`. */
export async function recordCardPaymentFailure(args: {
	eventId: string;
	paymentIntent: string;
	status: "failed" | "canceled";
	reason: string | null;
	livemode: boolean;
}): Promise<EventOutcome> {
	return outcomeOf(
		await serviceRpc("record_card_payment_failure", {
			p_event_id: args.eventId,
			p_provider_ref: args.paymentIntent,
			p_status: args.status,
			p_reason: args.reason,
			p_livemode: args.livemode,
		}),
	);
}

/** `identity.verification_session.*` → `finance.apply_identity_event`. */
export async function applyIdentityEvent(args: {
	eventId: string;
	eventType:
		| "identity.verification_session.verified"
		| "identity.verification_session.requires_input"
		| "identity.verification_session.canceled";
	session: string;
	errorCode: string | null;
	livemode: boolean;
}): Promise<EventOutcome> {
	return outcomeOf(
		await serviceRpc("apply_identity_event", {
			p_event_id: args.eventId,
			p_event_type: args.eventType,
			p_session_ref: args.session,
			p_error_code: args.errorCode,
			p_livemode: args.livemode,
		}),
	);
}

/** `transfer.created` → `finance.record_transfer_created`. */
export async function recordTransferCreated(args: {
	eventId: string;
	transfer: string;
	destination: string | null;
	amount: number;
	currency: string;
	payoutId: string | null;
	livemode: boolean;
}): Promise<EventOutcome> {
	return outcomeOf(
		await serviceRpc("record_transfer_created", {
			p_event_id: args.eventId,
			p_transfer_ref: args.transfer,
			p_destination: args.destination,
			p_amount: args.amount,
			p_currency: args.currency,
			p_payout_id: args.payoutId,
			p_livemode: args.livemode,
		}),
	);
}

/** `charge.dispute.created` → `finance.record_dispute_opened`. */
export async function recordDisputeOpened(args: {
	eventId: string;
	dispute: string;
	paymentIntent: string | null;
	amount: number;
	currency: string;
	reason: string | null;
	livemode: boolean;
}): Promise<EventOutcome> {
	return outcomeOf(
		await serviceRpc("record_dispute_opened", {
			p_event_id: args.eventId,
			p_dispute_ref: args.dispute,
			p_provider_ref: args.paymentIntent,
			p_amount: args.amount,
			p_currency: args.currency,
			p_reason: args.reason,
			p_livemode: args.livemode,
		}),
	);
}
// #endregion

// #region Processor doors added after the fiat rails (Decision #126)
/** `charge.dispute.closed` → `finance.record_dispute_closed`. */
export async function recordDisputeClosed(args: {
	eventId: string;
	dispute: string;
	status: string;
	livemode: boolean;
}): Promise<EventOutcome> {
	return outcomeOf(
		await serviceRpc("record_dispute_closed", {
			p_event_id: args.eventId,
			p_dispute_ref: args.dispute,
			p_status: args.status,
			p_livemode: args.livemode,
		}),
	);
}

/** The Transfer exists: close the payout as paid (`finance.complete_payout`). */
export async function completePayout(payoutId: string, transferRef: string): Promise<Payout> {
	return payoutOf(
		await serviceRpc("complete_payout", { p_payout_id: payoutId, p_transfer_ref: transferRef }),
	);
}

/** Stripe definitively refused the Transfer: return the money (`finance.fail_payout`). */
export async function failPayout(payoutId: string, reason: string): Promise<Payout> {
	return payoutOf(
		await serviceRpc("fail_payout", { p_payout_id: payoutId, p_reason: reason.slice(0, 400) }),
	);
}

/** Record a card a confirmed SetupIntent saved (`finance.record_saved_card`). */
export async function recordSavedCard(args: {
	ownerType: string;
	ownerId: string;
	paymentMethodRef: string;
	brand: string | null;
	last4: string | null;
	expMonth: number | null;
	expYear: number | null;
	createdBy: string | null;
	makeDefault: boolean;
}): Promise<SavedCardResult> {
	const row = await serviceRpc("record_saved_card", {
		p_owner_type: args.ownerType,
		p_owner_id: args.ownerId,
		p_payment_method_ref: args.paymentMethodRef,
		p_brand: args.brand,
		p_last4: args.last4,
		p_exp_month: args.expMonth,
		p_exp_year: args.expYear,
		p_created_by: args.createdBy,
		p_make_default: args.makeDefault,
	});
	return SavedCardResultSchema.parse({
		methodId: row.method_id,
		cardId: row.card_id,
		brand: String(row.brand ?? "unknown"),
		last4: typeof row.last4 === "string" ? row.last4 : null,
		expMonth: num(row.exp_month),
		expYear: num(row.exp_year),
		isDefault: row.is_default === true,
	});
}

/** One scheduled deposit the scheduler claimed. */
export interface ClaimedDeposit {
	payment: InboundPayment;
	ruleId: string;
	customerRef: string;
	paymentMethodRef: string;
}

/** Claim the recurring deposits that are due (`finance.claim_due_deposit_rules`). */
export async function claimDueDepositRules(limit: number): Promise<ClaimedDeposit[]> {
	const { data, error } = await getServiceClient().schema("finance").rpc(
		"claim_due_deposit_rules",
		{ p_limit: limit },
	);
	if (error) {
		throw new Error(
			`finance.claim_due_deposit_rules failed (${error.code ?? "no code"}): ${error.message}`,
		);
	}
	return (Array.isArray(data) ? data as Row[] : []).map((entry) => ({
		payment: inboundPaymentOf(entry.payment as Row),
		ruleId: String(entry.rule_id),
		customerRef: String(entry.customer_ref),
		paymentMethodRef: String(entry.payment_method_ref),
	}));
}

/** Bind a scheduled run to its PaymentIntent, or record the refusal (`finance.bind_scheduled_payment`). */
export async function bindScheduledPayment(
	paymentId: string,
	providerRef: string | null,
	error: string | null,
): Promise<InboundPayment> {
	return inboundPaymentOf(
		await serviceRpc("bind_scheduled_payment", {
			p_payment_id: paymentId,
			p_provider_ref: providerRef,
			p_error: error,
		}),
	);
}
// #endregion
