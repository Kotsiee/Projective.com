import {
	returnPathOf,
	stripeReturnOf,
	withoutStripeReturn,
} from "@features/payments/core/stripe-flow.ts";
import type { SettledPayment } from "@features/payments/core/PaymentsService.ts";

/**
 * express-return — the DOM-free half of finishing a processor payment at checkout: the address a
 * redirect-based wallet (PayPal) returns to, the reading of that return, and what the page does once
 * the signed webhook has settled the payment (Decision #153).
 *
 * The island binds {@link ExpressReturnIo} / {@link SettleIo} to the browser and the page's state; the
 * rules live here so a test can drive a whole return without a browser.
 */

// #region Return address
/** The params an express return carries beside Stripe's own: the payment, and its attempt key. */
export const RETURN_PAY = "pay";
export const RETURN_ATTEMPT = "attempt";
const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_KEY = /^co_[0-9a-z]+_[0-9a-z]+$/;

/** The page a return is built from: its path, query and origin. */
export interface ReturnLocation {
	pathname: string;
	search: string;
	origin: string;
}

/**
 * Where a redirect-based wallet returns: this page, minus any earlier Stripe return, plus the payment
 * and the attempt key it was started under — so the return resumes THAT payment.
 */
export function expressReturnPath(
	location: ReturnLocation,
	paymentId: string,
	key: string | null,
): string {
	const url = new URL(returnPathOf(location), location.origin);
	url.searchParams.set(RETURN_PAY, paymentId);
	if (key) url.searchParams.set(RETURN_ATTEMPT, key);
	return `${url.pathname}${url.search}`;
}

/** A redirect return this page came back with. */
export interface ExpressReturn {
	/** The `finance.inbound_payments` id the wallet paid. */
	paymentId: string;
	/** The attempt key the charge ran under, or `null` when the address carried none that is valid. */
	key: string | null;
	/** Stripe's `redirect_status` — a claim, never the fact. */
	status: string;
	/** The same address with every return param removed, for `history.replaceState`. */
	cleanPath: string;
}

/**
 * The express payment an address returned from, or `null`. Both ids are validated before use — they
 * arrive in a URL — and the address with every return param removed is handed back, so the caller
 * can make a reload unable to replay it.
 */
export function expressReturnOf(href: string): ExpressReturn | null {
	if (!href) return null;
	const url = new URL(href);
	const back = stripeReturnOf(url.searchParams);
	const paymentId = url.searchParams.get(RETURN_PAY) ?? "";
	if (!back || back.kind !== "payment" || !PAYMENT_ID.test(paymentId)) return null;
	const rawKey = url.searchParams.get(RETURN_ATTEMPT);
	const clean = withoutStripeReturn(url);
	clean.searchParams.delete(RETURN_PAY);
	clean.searchParams.delete(RETURN_ATTEMPT);
	return {
		paymentId,
		key: rawKey && ATTEMPT_KEY.test(rawKey) ? rawKey : null,
		status: back.status,
		cleanPath: `${clean.pathname}${clean.search}${clean.hash}`,
	};
}
// #endregion

// #region After the webhook
/** Said when the processor reports the payment failed. */
export const PAYMENT_FAILED = "The card payment didn't go through. Nothing was charged.";
/** Said when Stripe accepted the payment but the ledger has not heard yet. */
export const PAYMENT_PENDING =
	"Your bank accepted the payment, but it hasn't reached your wallet yet. Your order is placed automatically when it arrives — you'll get a notification.";
/** Said when a redirect-based wallet came back without completing the payment. */
export const WALLET_NOT_COMPLETED = "The wallet didn't complete the payment. Nothing was charged.";

/** What finishing a settled payment touches. */
export interface SettleIo {
	/** Wait for the signed webhook to settle the payment (or fail, or the wait to run out). */
	settle(paymentId: string): Promise<SettledPayment>;
	/** Open the confirmation of an order that already exists. */
	open(orderId: string): void;
	/** Place the order from the wallet under the attempt's key (a replay when it is already placed). */
	place(key: string | null): Promise<void>;
	/** Say what happened, in the buyer's words. */
	say(message: string): void;
}

/** How finishing a payment ended. */
export type SettleOutcome = "opened" | "placed" | "failed" | "pending";

/**
 * A card or express payment Stripe accepted, finished: only the signed webhook says the money
 * arrived, so wait for that. Nothing is ordered on the browser's word.
 *
 * The webhook places a checkout's order in the same transaction that settles its payment, so a
 * settled payment that names an order is DONE: open that order's confirmation and write nothing.
 * Re-placing it would read a basket the order has already emptied, and a redirect return, which
 * re-reads the basket on arrival, then stopped at "Nothing is selected" instead of the confirmation.
 * Only a payment settled with no order yet is placed from the wallet, under the charge's own attempt
 * key, so a webhook that wins in between makes it a replay of the same order.
 */
export async function finishSettled(
	paymentId: string,
	key: string | null,
	io: SettleIo,
): Promise<SettleOutcome> {
	const settled = await io.settle(paymentId);
	if (settled.outcome === "failed") {
		io.say(PAYMENT_FAILED);
		return "failed";
	}
	if (settled.outcome !== "succeeded") {
		io.say(PAYMENT_PENDING);
		return "pending";
	}
	if (settled.orderId) {
		io.open(settled.orderId);
		return "opened";
	}
	await io.place(key);
	return "placed";
}
// #endregion

// #region The return
/** What resuming a return touches: the address bar, then {@link finishSettled}. */
export interface ExpressReturnIo extends SettleIo {
	/** Replace the address in the history entry (never a new entry). */
	replace(path: string): void;
}

/**
 * Resume the payment a redirect-based wallet returned with, once. The return params are stripped
 * from the address before anything else, so a reload, or Back from the confirmation, finds none and
 * resumes nothing. Stripe's `redirect_status` is a claim: a `failed` one ends the attempt, and any
 * other is still decided by the webhook.
 */
export async function resumeExpressReturn(
	href: string,
	io: ExpressReturnIo,
): Promise<SettleOutcome | "none"> {
	const back = expressReturnOf(href);
	if (!back) return "none";
	io.replace(back.cleanPath);
	if (back.status === "failed") {
		io.say(WALLET_NOT_COMPLETED);
		return "failed";
	}
	return await finishSettled(back.paymentId, back.key, io);
}
// #endregion
