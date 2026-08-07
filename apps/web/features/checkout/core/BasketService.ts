import { deleteCheckout, getCheckout, patchCheckout, postCheckout } from "./api.ts";
import { buildCheckoutQuery, withContext } from "./basket-model.ts";
import type { CheckoutResponse } from "../types/results.ts";
import type {
	AddBasketItem,
	AppliedPromo,
	Basket,
	BasketSummary,
	CheckoutContext,
	MoveBasketItem,
	RemoveBasketItem,
	UpdateBasketItem,
} from "../types/checkout-types.ts";

/**
 * BasketService — the THIN client controller for `/api/basket*`.
 *
 * A dumb object of named methods: each builds a query string or a JSON payload, forwards through
 * {@link apiFetch}, and returns a soft {@link CheckoutResponse}. No money math, no fixtures, no
 * business rules — the fat `BasketBackendService` owns every total, the member gate and the corpus
 * lookup, and the client renders the `MoneyView`s it is handed (mirrors `WalletService`).
 *
 * Every response — read AND write — carries the SAME `{ baskets, basket, promo }` shape, so a caller
 * replaces its state wholesale rather than patching a line or a total by hand. That is deliberate on a
 * money surface: a locally-patched subtotal is a second arithmetic path, and two arithmetic paths
 * eventually disagree about what the buyer owes.
 */

/** The payload every basket endpoint answers with — read and write alike. */
export interface BasketPayload {
	baskets: BasketSummary[];
	basket: Basket;
	promo: AppliedPromo | null;
}

/** Create a further named basket (a wishlist, a project shopping list). */
export interface CreateBasketInput {
	name: string;
}

function qs(ctx: CheckoutContext): string {
	const q = buildCheckoutQuery(ctx);
	return q ? `?${q}` : "";
}

export const BasketService = {
	/**
	 * The acting account's baskets AND the one the context targets, in one round trip — the surface
	 * renders the switcher and the basket together, so splitting them would only open a window in which
	 * the two disagree.
	 */
	get(ctx: CheckoutContext): Promise<CheckoutResponse<BasketPayload>> {
		return getCheckout(`/api/basket${qs(ctx)}`);
	},

	/** Create a further named basket for the acting account. */
	createBasket(
		input: CreateBasketInput,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<BasketPayload>> {
		return postCheckout("/api/basket", withContext({ ...input }, ctx));
	},

	/**
	 * Add a purchasable. A `null` `basketId` lands in the account's default basket, so an add-to-basket
	 * from anywhere on the platform needs no prior lookup.
	 */
	addItem(input: AddBasketItem, ctx: CheckoutContext): Promise<CheckoutResponse<BasketPayload>> {
		return postCheckout("/api/basket/item", withContext({ ...input }, ctx));
	},

	/** Patch one line — quantity, selection, parking, delivery address, slot, stage or seats. */
	updateItem(
		input: UpdateBasketItem,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<BasketPayload>> {
		return patchCheckout("/api/basket/item", withContext({ ...input }, ctx));
	},

	/** Remove a line outright. Soft server-side — the row is stamped, never destroyed. */
	removeItem(
		input: RemoveBasketItem,
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<BasketPayload>> {
		return deleteCheckout("/api/basket/item", withContext({ ...input }, ctx));
	},

	/** Move a line between baskets, reorder it, and/or park it into saved-for-later. */
	moveItem(input: MoveBasketItem, ctx: CheckoutContext): Promise<CheckoutResponse<BasketPayload>> {
		return postCheckout("/api/basket/move", withContext({ ...input }, ctx));
	},

	/**
	 * Attach a promotional code to a whole basket, or clear it with `code: null`.
	 *
	 * The saving is resolved and clamped SERVER-side; a refused code still comes back as a resolved
	 * `promo` carrying its reason, so the surface can say *why* it did not apply rather than merely
	 * failing to change the total.
	 */
	applyPromo(
		input: { basketId: string; code: string | null },
		ctx: CheckoutContext,
	): Promise<CheckoutResponse<BasketPayload>> {
		return postCheckout("/api/basket/promo", withContext({ ...input }, ctx));
	},
};
