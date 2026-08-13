import { getCheckout, postCheckout } from "./api.ts";
import { buildCheckoutQuery, withContext } from "./basket-model.ts";
import type { CheckoutResponse } from "../types/results.ts";
import type {
	BillingContext,
	BuyerDetails,
	CheckoutContext,
	CheckoutResult,
	CheckoutSessionContext,
	CreateCheckout,
	MonthlyInvoicing,
	OrderPage,
	SaveBuyerDetails,
} from "../types/checkout-types.ts";

/**
 * CheckoutService — the THIN client controller for `/api/checkout/*`.
 *
 * Two calls: read the whole server projection the checkout page renders, and submit a charge. Neither
 * computes anything. The client does not total the basket, does not derive the platform fee, does not
 * decide which providers are eligible and does not judge whether the wallet covers the bill — all five
 * are the fat `CheckoutBackendService`'s answers, delivered pre-computed and pre-formatted.
 *
 * The one number the client DOES send is `expectedTotalMinor`: the total the buyer was SHOWN. It is not
 * a computation, it is a witness statement — the server recomputes and refuses on mismatch, so a price
 * that moved between render and submit is caught instead of silently charged.
 */

/**
 * The Details step's payload — one saved record, every identity it could belong to, and the
 * monthly-invoicing offer for the active one.
 *
 * `invoicing` is the active record's OWN block rather than a second resolution of it, so the control
 * and the record it edits can never disagree about which mode is set.
 */
export interface BuyerDetailsPayload {
	buyer: BuyerDetails;
	billingContexts: BillingContext[];
	invoicing: MonthlyInvoicing;
}

export const CheckoutService = {
	/**
	 * The checkout page's entire server projection: which account is paying, which lines, the
	 * server-computed groups and totals, all six providers with a reason on every refusal, what the
	 * wallet covers, the cards on file, and everything currently blocking Pay.
	 */
	session(ctx: CheckoutContext): Promise<CheckoutResponse<{ session: CheckoutSessionContext }>> {
		const q = buildCheckoutQuery(ctx);
		return getCheckout(`/api/checkout/session${q ? `?${q}` : ""}`);
	},

	/**
	 * Charge a checkout.
	 *
	 * The payload names the exact lines being paid for, so a basket changed in another tab cannot widen
	 * the charge, and carries a client-minted `idempotencyKey` held for the life of ONE attempt — a
	 * double-click, a retried submit or a reconnect after a dropped response replays the stored outcome
	 * instead of charging twice.
	 *
	 * The route always answers `200`: a refusal is an OUTCOME the surface renders (status · message ·
	 * blockers), not a transport error, so a caller reads `data.result.status` rather than `ok`.
	 */
	create(
		input: CreateCheckout,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<{ result: CheckoutResult }>> {
		return postCheckout("/api/checkout/create", withContext({ ...input }, ctx));
	},

	/**
	 * The buyer's saved delivery + billing record for the active identity, the identities they may
	 * bill through, and the monthly-invoicing offer.
	 *
	 * The same three values the session already carries. They are read separately so the Details page
	 * can refresh after a save without re-resolving a whole checkout — and both paths read the ONE
	 * record server-side, so the answer that decided the auto-skip is the answer that prints on the
	 * invoice.
	 */
	details(ctx: CheckoutContext): Promise<CheckoutResponse<BuyerDetailsPayload>> {
		const q = buildCheckoutQuery(ctx);
		return getCheckout(`/api/checkout/details${q ? `?${q}` : ""}`);
	},

	/**
	 * Save the whole record as one atomic edit.
	 *
	 * The response carries the refreshed record AND the whole session, because saving is what clears
	 * the `missing_details` blocker: a caller handed only the record would still be holding a stale
	 * gate, and would need a second round trip to find out that Pay had opened.
	 *
	 * Sent as a `POST` rather than the route's canonical `PUT` only because the shared transport
	 * publishes no `PUT`; the route answers to both and the payload is identical either way.
	 */
	saveDetails(
		input: SaveBuyerDetails,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<BuyerDetailsPayload & { session: CheckoutSessionContext }>> {
		return postCheckout("/api/checkout/details", withContext({ ...input }, ctx));
	},

	/**
	 * The confirmation hub's read: a completed order and the account's other recent ones.
	 *
	 * A `null` `orderId` resolves the account's most recent, which is what keeps the page usable from
	 * a link that lost its query string. This is always a READ — the charge was written once, when it
	 * was attempted, and re-submitting it from a confirmation page is how one payment becomes two.
	 */
	order(
		orderId: string | null,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<{ page: OrderPage }>> {
		const qs = new URLSearchParams(buildCheckoutQuery(ctx));
		if (orderId) qs.set("order", orderId);
		const q = qs.toString();
		return getCheckout(`/api/checkout/order${q ? `?${q}` : ""}`);
	},
};
