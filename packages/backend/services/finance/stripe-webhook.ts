import { type HandledStripeEvent, payoutAccountStatusFor } from "@projective/types/finance";
import { getStripe, type Stripe } from "../../core/stripe.ts";
import {
	applyIdentityEvent,
	type EventOutcome,
	recordCardPaymentFailure,
	recordDisputeClosed,
	recordDisputeOpened,
	recordSavedCard,
	recordTransferCreated,
	settleCardPayment,
	syncPayoutAccount,
} from "./live-payments.ts";
import { type ConfirmedCard, confirmedCardOf, retrieveTransfersCapability } from "./stripe-rails.ts";

/**
 * stripe-webhook — what a VERIFIED Stripe event means for the ledger, as a pure plan, and the one
 * function that carries a plan out through the processor doors.
 *
 * Splitting the two is the point: {@link planStripeEvent} is a total, side-effect-free reading of an
 * event object (testable with a literal), and {@link applyStripePlan} is nothing but a dispatch onto
 * `finance.*` definer functions that do the real work — atomically, and idempotently on the event id.
 * Nothing here decides whether money moves; the database does, from the facts this module extracts.
 *
 * Only facts are read off an event: ids, amounts, currencies, statuses and error CODES. A payment's
 * card details, a dispute's evidence and — above all — anything Stripe Identity extracted from a
 * document are never read, so they can never be stored (no PII in domain tables).
 */

// #region The plan
/** What one verified event asks the ledger to do. */
export type StripePlan =
	| { kind: "payment_succeeded"; paymentIntent: string; amountReceived: number; currency: string }
	| {
		kind: "payment_failed";
		paymentIntent: string;
		status: "failed" | "canceled";
		reason: string | null;
	}
	| {
		kind: "identity";
		eventType: Extract<HandledStripeEvent, `identity.${string}`>;
		session: string;
		errorCode: string | null;
	}
	| {
		kind: "transfer_created";
		transfer: string;
		destination: string | null;
		amount: number;
		currency: string;
		payoutId: string | null;
	}
	| {
		kind: "dispute_created";
		dispute: string;
		paymentIntent: string | null;
		amount: number;
		currency: string;
		reason: string | null;
	}
	| { kind: "dispute_closed"; dispute: string; status: string }
	| { kind: "account_updated"; account: string }
	| { kind: "card_saved"; card: ConfirmedCard }
	| { kind: "ignore"; reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An expandable Stripe reference (`"pi_…"` or the expanded object) as its id. */
function idOf(ref: unknown): string | null {
	if (typeof ref === "string") return ref;
	if (ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string") {
		return (ref as { id: string }).id;
	}
	return null;
}

function text(value: unknown, max = 200): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

/**
 * Read a verified event into a plan. Total: an event whose object lacks the facts its type promises is
 * planned as `ignore` with the reason, never as a half-filled action.
 */
export function planStripeEvent(event: Stripe.Event): StripePlan {
	switch (event.type) {
		case "payment_intent.succeeded": {
			const intent = event.data.object;
			if (!intent.id || !Number.isInteger(intent.amount_received) || !intent.currency) {
				return { kind: "ignore", reason: "the PaymentIntent is missing its amount or currency" };
			}
			return {
				kind: "payment_succeeded",
				paymentIntent: intent.id,
				amountReceived: intent.amount_received,
				currency: intent.currency.toUpperCase(),
			};
		}
		case "payment_intent.payment_failed": {
			const intent = event.data.object;
			const error = intent.last_payment_error;
			return {
				kind: "payment_failed",
				paymentIntent: intent.id,
				status: "failed",
				// The decline CODE, not the processor's prose: codes are stable and carry nothing personal.
				reason: text(error?.decline_code) ?? text(error?.code),
			};
		}
		case "payment_intent.canceled": {
			const intent = event.data.object;
			return {
				kind: "payment_failed",
				paymentIntent: intent.id,
				status: "canceled",
				reason: text(intent.cancellation_reason),
			};
		}
		case "identity.verification_session.verified":
		case "identity.verification_session.requires_input":
		case "identity.verification_session.canceled": {
			const session = event.data.object;
			return {
				kind: "identity",
				eventType: event.type,
				session: session.id,
				errorCode: text(session.last_error?.code, 80),
			};
		}
		case "transfer.created": {
			const transfer = event.data.object;
			const payoutId = text(transfer.metadata?.projective_payout_id, 64);
			return {
				kind: "transfer_created",
				transfer: transfer.id,
				destination: idOf(transfer.destination),
				amount: transfer.amount,
				currency: transfer.currency.toUpperCase(),
				payoutId: payoutId && UUID_RE.test(payoutId) ? payoutId : null,
			};
		}
		case "charge.dispute.created": {
			const dispute = event.data.object;
			return {
				kind: "dispute_created",
				dispute: dispute.id,
				paymentIntent: idOf(dispute.payment_intent),
				amount: dispute.amount,
				currency: dispute.currency.toUpperCase(),
				reason: text(dispute.reason, 120),
			};
		}
		case "charge.dispute.closed": {
			const dispute = event.data.object;
			return { kind: "dispute_closed", dispute: dispute.id, status: String(dispute.status) };
		}
		case "account.updated": {
			// Only the id is taken from the event: the account's state is re-read from Stripe before
			// anything is applied, so an out-of-order or replayed delivery can never regress a status.
			const account = event.data.object;
			return account?.id
				? { kind: "account_updated", account: account.id }
				: { kind: "ignore", reason: "the account event carries no account id" };
		}
		case "setup_intent.succeeded": {
			const card = confirmedCardOf(event.data.object);
			if (!card.paymentMethodId || !card.ownerType || !card.ownerId) {
				return { kind: "ignore", reason: "the SetupIntent is not one Projective started" };
			}
			return { kind: "card_saved", card };
		}
		default:
			return { kind: "ignore", reason: `event type ${event.type} is not handled` };
	}
}
// #endregion

// #region Carrying a plan out
/**
 * Apply a plan through its processor door. Throws when the database could not be reached or refused
 * the call — the webhook must then answer 5xx so Stripe redelivers the event, which the door's event
 * claim makes safe.
 */
export function applyStripePlan(
	eventId: string,
	plan: Exclude<StripePlan, { kind: "ignore" }>,
	livemode: boolean,
): Promise<EventOutcome> {
	switch (plan.kind) {
		case "payment_succeeded":
			return settleCardPayment({
				eventId,
				paymentIntent: plan.paymentIntent,
				amountReceived: plan.amountReceived,
				currency: plan.currency,
				livemode,
			});
		case "payment_failed":
			return recordCardPaymentFailure({
				eventId,
				paymentIntent: plan.paymentIntent,
				status: plan.status,
				reason: plan.reason,
				livemode,
			});
		case "identity":
			return applyIdentityEvent({
				eventId,
				eventType: plan.eventType,
				session: plan.session,
				errorCode: plan.errorCode,
				livemode,
			});
		case "transfer_created":
			return recordTransferCreated({
				eventId,
				transfer: plan.transfer,
				destination: plan.destination,
				amount: plan.amount,
				currency: plan.currency,
				payoutId: plan.payoutId,
				livemode,
			});
		case "dispute_created":
			return recordDisputeOpened({
				eventId,
				dispute: plan.dispute,
				paymentIntent: plan.paymentIntent,
				amount: plan.amount,
				currency: plan.currency,
				reason: plan.reason,
				livemode,
			});
		case "dispute_closed":
			return recordDisputeClosed({ eventId, dispute: plan.dispute, status: plan.status, livemode });
		case "account_updated":
			return syncConnectAccount(plan.account);
		case "card_saved":
			return saveCardFromEvent(plan.card);
	}
}

/**
 * Re-read a Connect account's recipient transfers capability from Stripe and apply it — the shared
 * body of the v1 `account.updated` snapshot event and the v2 thin capability events. Idempotent by
 * VALUE (`finance.sync_payout_account` sets the status Stripe reports now), so it needs no event
 * claim: a replayed or out-of-order delivery re-applies the current truth. An account Projective did
 * not record is acknowledged as unmatched.
 */
export async function syncConnectAccount(accountId: string): Promise<EventOutcome> {
	const capability = await retrieveTransfersCapability(getStripe(), accountId);
	const status = payoutAccountStatusFor(capability);
	try {
		const synced = await syncPayoutAccount(accountId, status);
		return {
			outcome: "applied",
			detail: `payout account ${status}${synced.payoutReady ? " (payable)" : ""}`,
			raw: { status, payout_ready: synced.payoutReady },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/P0002|no payout account is recorded/.test(message)) {
			return { outcome: "unmatched", detail: "no payout account is recorded for that account", raw: {} };
		}
		throw error;
	}
}

/**
 * Record the card a `setup_intent.succeeded` event reports — the backstop for a browser that confirmed
 * the SetupIntent and then never called back. The owner comes from the metadata Projective stamped
 * when it created the SetupIntent; the door is idempotent on (owner, payment method).
 */
async function saveCardFromEvent(card: ConfirmedCard): Promise<EventOutcome> {
	const saved = await recordSavedCard({
		ownerType: card.ownerType!,
		ownerId: card.ownerId!,
		paymentMethodRef: card.paymentMethodId!,
		brand: card.brand,
		last4: card.last4,
		expMonth: card.expMonth,
		expYear: card.expYear,
		createdBy: card.createdBy,
		makeDefault: false,
	});
	return { outcome: "applied", detail: `card saved (${saved.brand} ${saved.last4 ?? ""})`, raw: {} };
}
// #endregion
