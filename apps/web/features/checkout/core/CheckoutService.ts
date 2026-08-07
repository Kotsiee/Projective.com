import { getCheckout, postCheckout } from "./api.ts";
import { buildCheckoutQuery, withContext } from "./basket-model.ts";
import type { CheckoutResponse } from "../types/results.ts";
import type {
	CheckoutContext,
	CheckoutResult,
	CheckoutSessionContext,
	CreateCheckout,
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
};
