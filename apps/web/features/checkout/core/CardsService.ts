import { deleteCheckout, getCheckout, postCheckout } from "./api.ts";
import { buildCheckoutQuery, withContext } from "./basket-model.ts";
import type { CheckoutResponse } from "../types/results.ts";
import type { CheckoutContext, SaveCardInput, SavedCard } from "../types/checkout-types.ts";

/**
 * CardsService — the THIN client controller for `/api/cards*`.
 *
 * ⚠️ **Nothing in this module can express a card number.** A card is collected by Stripe Elements in an
 * iframe this application does not script; only the resulting opaque `stripePaymentMethodId` passes
 * through here, and {@link SaveCardInput} has no PAN and no CVV field to populate. Brand, last4 and
 * expiry are resolved SERVER-side from Stripe rather than sent — a client that could supply them could
 * mislabel a card. The boundary is structural, not a convention, and any future "add a card" form on
 * this surface must keep it that way: no input that accepts a number.
 */

/** What every cards read/write answers with. */
export interface CardsPayload {
	cards: SavedCard[];
	/** The card a card payment would use; `null` when none is usable for this account. */
	defaultCardId: string | null;
	/** The card a write just created or changed; absent on a plain list. */
	card?: SavedCard;
}

function qs(ctx: CheckoutContext): string {
	const q = buildCheckoutQuery(ctx);
	return q ? `?${q}` : "";
}

export const CardsService = {
	/** Every card on file for the acting account, plus the one a card payment pre-selects. */
	list(ctx: CheckoutContext): Promise<CheckoutResponse<CardsPayload>> {
		return getCheckout(`/api/cards${qs(ctx)}`);
	},

	/** Register a tokenised card against the acting account. */
	save(input: SaveCardInput, ctx: CheckoutContext): Promise<CheckoutResponse<CardsPayload>> {
		return postCheckout("/api/cards", withContext({ ...input }, ctx));
	},

	/** Make one card the account's default. An expired card is refused rather than silently accepted. */
	setDefault(cardId: string, ctx: CheckoutContext): Promise<CheckoutResponse<CardsPayload>> {
		return postCheckout("/api/cards/default", withContext({ cardId }, ctx));
	},

	/**
	 * Detach a card. Removing the default promotes the next usable one, so an account is never left
	 * with cards on file and none selected.
	 *
	 * The id travels in the PATH (the route is `/api/cards/[id]`), so the acting scope has to ride the
	 * query string — a DELETE body would be dropped by the route's `basketQueryFrom`, which reads the
	 * URL.
	 */
	remove(cardId: string, ctx: CheckoutContext): Promise<CheckoutResponse<CardsPayload>> {
		return deleteCheckout(`/api/cards/${encodeURIComponent(cardId)}${qs(ctx)}`, {});
	},
};
