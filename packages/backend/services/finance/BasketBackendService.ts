import { z } from "zod";
import type {
	AddBasketItem,
	AppliedPromo,
	ApplyPromoCode,
	Basket,
	BasketLists,
	BasketSummary,
	CreateBasketList,
	MoveBasketItem,
	RemoveBasketItem,
	UpdateBasketItem,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import type { BasketQuery } from "./basket-query.ts";
import * as live from "./live-basket.ts";

/**
 * BasketBackendService — the FAT half of the `/basket` surface: every read projection (the owner's
 * basket list, a resolved basket with its server-computed groups and totals) and every write
 * (add · update · move · remove · promo · create-basket), each returning a transport-agnostic
 * {@link ServiceResult}.
 *
 * Everything reads and writes `finance.baskets` / `finance.basket_items` LIVE, as the signed-in
 * caller ({@link live}). The acting identity is the `ReadActor` the route derived from the session —
 * never a request field — and the database decides, through the same predicates its RLS policies are
 * made of, whether that caller may see or spend from the account the request names.
 *
 * **All money math lives server-side** and goes through the SSOT's one arithmetic path —
 * `basketSubtotal` / `applyDiscounts` / `isCheckoutEligible`. The thin `/api/basket/*` routes parse +
 * Zod-validate + delegate; islands never reach this module (root CLAUDE.md §2). The client renders the
 * `MoneyView`s it is handed and never sums, discounts, converts or formats one.
 */

// #region Local payloads
/**
 * Create a further named basket.
 *
 * The finance SSOT carries `CreateBasketListSchema` for the lane; this is the basket collection's own
 * (identical in shape) payload, declared beside its only consumer rather than invented in the route.
 */
export const CreateBasketSchema = z.object({
	name: z.string().trim().min(1).max(120),
	ownerType: z.string().max(40).optional(),
	ownerId: z.string().max(120).optional(),
});
export type CreateBasketInput = z.infer<typeof CreateBasketSchema>;
// #endregion

/** What a basket read returns: the owner's baskets plus the one resolved by the query. */
export interface BasketReadPayload {
	baskets: BasketSummary[];
	basket: Basket;
	/** The promo attached to the resolved basket, re-resolved against its current lines. */
	promo: AppliedPromo | null;
}

/** What a basket write returns: the refreshed basket, its siblings, and the resolved promo. */
export interface BasketWritePayload extends BasketReadPayload {}

/** Fold a live outcome into a {@link ServiceResult}; an unexpected failure is a 503, never a throw. */
async function settle<T, R>(
	run: () => Promise<live.BasketOutcome<T>>,
	shape: (value: T) => R,
): Promise<ServiceResult<R>> {
	try {
		const out = await run();
		if (!out.ok) return fail(out.status, { message: out.message, errors: out.errors });
		return ok(shape(out.value), out.message ? { message: out.message } : undefined);
	} catch (error) {
		console.error("[basket]", error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't reach your basket just now. Try again in a moment." });
	}
}

/** The read shape every basket response carries. */
function payloadOf(view: live.BasketView): BasketReadPayload {
	return { baskets: view.baskets, basket: view.basket, promo: view.promo };
}

export class BasketBackendService {
	/** The owner's basket list — the switcher between a default basket and any named ones. */
	static list(
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ baskets: BasketSummary[] }>> {
		return settle(() => live.readBasket(query, actor), (view) => ({ baskets: view.baskets }));
	}

	/**
	 * The basket lane's navigation model: the account's named lists (default first, the parked shelf
	 * trailing), plus the engagement-derived Tickets and Sessions groups over the ACTIVE basket — in ONE
	 * pass, so the three sections cannot disagree about a line's membership.
	 *
	 * `activeId` is the entry the URL addresses, passed in so the lane paints its active row on the
	 * first byte.
	 */
	static lists(
		query: BasketQuery,
		actor: ReadActor,
		activeId?: string | null,
	): Promise<ServiceResult<{ lists: BasketLists }>> {
		return settle(() => live.readLists(query, actor, activeId ?? null), (lists) => ({ lists }));
	}

	/**
	 * Create a further named list — a non-default `finance.baskets` row — answering with the refreshed
	 * lane model with the new list already ACTIVE, so the lane selects what the buyer just made in one
	 * round trip.
	 */
	static createList(
		input: CreateBasketList,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ lists: BasketLists }>> {
		return settle(
			() => live.createBasket(input.name, query, actor),
			(view) => ({ lists: live.listsOf(view, view.basket.id) }),
		);
	}

	/** A resolved basket with its lines, its server-computed groups, its totals and any promo. */
	static get(query: BasketQuery, actor: ReadActor): Promise<ServiceResult<BasketReadPayload>> {
		return settle(() => live.readBasket(query, actor), payloadOf);
	}

	/**
	 * Add a purchasable to a basket. A `null` `basketId` lands in the owner's default basket, so an
	 * add-to-basket from anywhere on the platform needs no prior lookup.
	 */
	static addItem(
		input: AddBasketItem,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<BasketWritePayload>> {
		return settle(() => live.addItem(input, query, actor), payloadOf);
	}

	/** Patch one line — quantity, selection, parking, delivery address, slot, stage or seats. */
	static updateItem(
		input: UpdateBasketItem,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<BasketWritePayload>> {
		return settle(() => live.updateItem(input, query, actor), payloadOf);
	}

	/** Remove a line outright. Soft — the row is stamped, never destroyed (root CLAUDE.md §5). */
	static removeItem(
		input: RemoveBasketItem,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<BasketWritePayload>> {
		return settle(() => live.removeItem(input, query, actor), payloadOf);
	}

	/** Move a line between baskets and/or park it into saved-for-later. */
	static moveItem(
		input: MoveBasketItem,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<BasketWritePayload>> {
		return settle(() => live.moveItem(input, query, actor), payloadOf);
	}

	/**
	 * Attach (or clear, with a `null` code) a promotional code. The saving is resolved against the
	 * basket's current lines and clamped by the SSOT's `applyDiscounts`, so a code worth more than the
	 * basket reduces it to zero rather than minting a credit. A REFUSED code is passed straight
	 * through, so the surface can explain it against the field the buyer typed into.
	 */
	static applyPromo(
		input: ApplyPromoCode,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<BasketWritePayload>> {
		return settle(
			() => live.applyPromo(input.basketId, input.code, query, actor),
			(view) => ({ baskets: view.baskets, basket: view.basket, promo: view.applied }),
		);
	}

	/** Create a further named basket for the owner. */
	static createBasket(
		input: CreateBasketInput,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<BasketWritePayload>> {
		return settle(() => live.createBasket(input.name, query, actor), payloadOf);
	}
}
