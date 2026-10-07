import { CARD_SETUP_PAYMENT_METHOD_TYPES } from "@projective/types/finance";

/**
 * stripe-flow — the pure, DOM-free halves of a browser Stripe flow: the options a deferred card form
 * is mounted with, and the reading and clearing of Stripe's redirect return.
 *
 * Kept apart from `stripe-js.ts` (which touches `document` and `window.Stripe`) so the rules are
 * testable without a browser, and from the hooks so a page can read a return without mounting a
 * form.
 */

// #region Deferred card setup
/**
 * An Elements group mounted BEFORE its intent exists — Stripe's "collect payment details before
 * creating an Intent" flow. `currency` is required by the Payment Element in this mode (lowercase
 * ISO); `allowedPaymentMethodTypes` narrows the form and must match the intent created at confirm.
 * The appearance is added where the group is created (`stripe-js.ts`), because it reads the DOM.
 */
export interface StripeDeferredElementsOptions {
	mode: "setup" | "payment";
	currency: string;
	/**
	 * Minor units — REQUIRED by Stripe in `payment` mode, where it is the amount a wallet sheet shows
	 * and must equal the PaymentIntent created at confirm (the checkout's Express Checkout Element).
	 */
	amount?: number;
	allowedPaymentMethodTypes?: string[];
}

/**
 * The Elements options of the card form mounted BEFORE a SetupIntent exists (Stripe's "collect
 * payment details before creating an Intent"): `mode: 'setup'`, the currency the Payment Element
 * requires in deferred mode (lowercase ISO), and the card-only method list the server's SetupIntent
 * names too (`CARD_SETUP_PAYMENT_METHOD_TYPES`) — Stripe requires the two to match.
 */
export function cardSetupElementsOptions(currency: string): StripeDeferredElementsOptions {
	return {
		mode: "setup",
		currency: currency.trim().toLowerCase(),
		allowedPaymentMethodTypes: [...CARD_SETUP_PAYMENT_METHOD_TYPES],
	};
}
// #endregion

// #region Redirect return
/**
 * The query params Stripe appends to a `return_url` when a confirmation had to leave the page (a
 * bank's 3-D Secure page, a redirect-based method). Only these are ever stripped from an address.
 */
export const STRIPE_RETURN_PARAMS = [
	"setup_intent",
	"setup_intent_client_secret",
	"payment_intent",
	"payment_intent_client_secret",
	"redirect_status",
] as const;

/** A redirect return Stripe sent the browser back with. */
export interface StripeReturn {
	/** `setup` — a card was being saved; `payment` — a card was being charged. */
	kind: "setup" | "payment";
	/** The intent id (`seti_…` / `pi_…`). The client secret beside it is never read. */
	intentId: string;
	/** Stripe's `redirect_status` — `succeeded`, `processing` or `failed`. A claim, never the fact. */
	status: string;
}

const SETUP_INTENT_ID = /^seti_[A-Za-z0-9_]+$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/;

/**
 * The return Stripe sent this address back with, or `null`. A SetupIntent wins when (impossibly)
 * both are present, and a malformed id is no return at all — the id goes to the server, which
 * re-reads the intent from Stripe before anything is recorded.
 */
export function stripeReturnOf(params: URLSearchParams): StripeReturn | null {
	const status = params.get("redirect_status");
	if (!status) return null;
	const setup = params.get("setup_intent");
	if (setup && SETUP_INTENT_ID.test(setup)) return { kind: "setup", intentId: setup, status };
	const payment = params.get("payment_intent");
	if (payment && PAYMENT_INTENT_ID.test(payment)) {
		return { kind: "payment", intentId: payment, status };
	}
	return null;
}

/** Whether an address carries any of Stripe's return params. */
function hasStripeReturn(params: URLSearchParams): boolean {
	return STRIPE_RETURN_PARAMS.some((name) => params.has(name));
}

/**
 * The same address without Stripe's return params: the path, the hash and every other param — the
 * wallet in view (`w`), the display currency, the cash-flow window — are kept.
 */
export function withoutStripeReturn(url: URL): URL {
	const next = new URL(url.href);
	if (!hasStripeReturn(next.searchParams)) return next;
	for (const name of STRIPE_RETURN_PARAMS) next.searchParams.delete(name);
	return next;
}

/**
 * Where a redirect-based step returns to: the page in view with its query intact (so `?w=` brings
 * the person back to the wallet they were in, never a bare `/wallet`), minus any earlier return.
 */
export function returnPathOf(location: { pathname: string; search: string }): string {
	const params = new URLSearchParams(location.search);
	if (!hasStripeReturn(params)) return `${location.pathname}${location.search}`;
	for (const name of STRIPE_RETURN_PARAMS) params.delete(name);
	const query = params.toString();
	return query ? `${location.pathname}?${query}` : location.pathname;
}
// #endregion
