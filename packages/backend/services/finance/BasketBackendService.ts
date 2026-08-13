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
import { isFinanceBackendLive } from "../../core/supabase.ts";
import type { BasketQuery } from "./basket-query.ts";
import * as fx from "./basket-fixtures.ts";

/**
 * BasketBackendService — the FAT half of the `/basket` surface: every read projection (the owner's
 * basket list, a resolved basket with its server-computed groups and totals) and every write
 * (add · update · move · remove · promo · create-basket), each returning a transport-agnostic
 * {@link ServiceResult}.
 *
 * **All money math lives here** (or in {@link fx `basket-fixtures`}, which it delegates to) and every
 * figure of it goes through the SSOT's one arithmetic path — `basketSubtotal` / `applyDiscounts` /
 * `isCheckoutEligible`. The thin `/api/basket/*` routes parse + Zod-validate + resolve the acting
 * context + delegate; islands never reach this module (root CLAUDE.md §2). The client renders the
 * `MoneyView`s it is handed and never sums, multiplies, discounts or formats one.
 *
 * **Context scoping is enforced here, not in the client.** A basket belongs to a principal — an
 * individual, or a team/business/organisation — and an individual may not spend an entity's money.
 * {@link fx.resolveOwner} resolves which account a request acts for (from the acting context, an
 * explicit `?owner=` override, or the simulated persona) and every write passes a member gate that
 * refuses a non-member with a human-readable reason rather than an empty basket.
 *
 * Gated by {@link isFinanceBackendLive} (`FINANCE_BACKEND_LIVE`, default off): until the RLS-scoped
 * `finance.baskets` / `finance.basket_items` tables and their mutation policies are wired, reads answer
 * from deterministic fixtures derived from the discovery corpus and writes mutate an in-module session
 * store (fully exercisable, no persistence). The LIVE branch is a documented placeholder that falls
 * back to the same fixtures with zero shape churn — the projections are already the Zod SSOT — exactly
 * like every sibling read/write service.
 */

// #region Local payloads (shapes the frozen SSOT does not yet carry)
/**
 * Create a further named basket.
 *
 * The finance SSOT carries `Add`/`Update`/`Move`/`Remove`/`ApplyPromoCode` but no create-basket payload,
 * so the shape is declared here beside its only consumer rather than invented separately in the route.
 * **It belongs in `@projective/types/finance/basket.ts`** and should move there when that contract is
 * next opened — flagged, not silently forked.
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

export class BasketBackendService {
	/**
	 * The owner's basket list — the switcher between a default basket and any named ones (a wishlist,
	 * a project shopping list).
	 */
	static list(query: BasketQuery): ServiceResult<{ baskets: BasketSummary[] }> {
		if (isFinanceBackendLive()) {
			// LIVE: `select … from finance.baskets where owner_type = $1 and owner_id = $2` under the
			// caller's JWT (RLS scopes it) — not yet implemented; fall back to fixtures.
		}
		return ok({ baskets: fx.listBaskets(query) });
	}

	/**
	 * The basket lane's navigation model: the account's named lists (default first, the parked shelf
	 * trailing), plus the engagement-derived Tickets and Sessions groups over the ACTIVE basket.
	 *
	 * Computed in ONE pass so the three sections cannot disagree about a line's membership, and every
	 * subtotal is the SSOT's `basketSubtotal` over that section's own lines — the lane footer's figure
	 * is therefore the same arithmetic the basket body and the checkout total run through.
	 *
	 * `activeId` is the entry the URL addresses. It is passed in rather than inferred so the lane
	 * paints its active row on the FIRST byte, without a client round trip to discover which list it
	 * is looking at.
	 */
	static lists(
		query: BasketQuery,
		activeId?: string | null,
	): ServiceResult<{ lists: BasketLists }> {
		if (isFinanceBackendLive()) {
			// LIVE: one read of `finance.baskets` + `finance.basket_items` under the caller's JWT, then
			// the SAME grouping — not yet implemented; fall back to fixtures.
		}
		const owner = fx.resolveOwner(query);
		const basket = fx.basketFor(owner, query.basketId);
		return ok({ lists: fx.buildLists(owner, basket, activeId ?? query.basketId ?? null) });
	}

	/**
	 * Create a further named list — which is simply a non-default `finance.baskets` row.
	 *
	 * Answers with the refreshed lane model rather than the created basket alone, with the new list
	 * already ACTIVE, so the lane can select what the buyer just made in one round trip instead of
	 * creating and then re-reading to find out where it landed.
	 */
	static createList(
		input: CreateBasketList,
		query: BasketQuery,
	): ServiceResult<{ lists: BasketLists }> {
		const outcome = fx.createBasket(input.name, query);
		if (!outcome.ok || !outcome.basket) {
			return fail(outcome.status ?? 422, { message: outcome.message });
		}
		const owner = fx.resolveOwner(query);
		return ok(
			{ lists: fx.buildLists(owner, outcome.basket, outcome.basket.id) },
			{ message: outcome.message },
		);
	}

	/**
	 * A resolved basket with its lines, its server-computed groups, its totals and any attached promo.
	 * Returns the sibling summaries in the same call because the surface renders both.
	 */
	static get(query: BasketQuery): ServiceResult<BasketReadPayload> {
		if (isFinanceBackendLive()) {
			// LIVE: join `finance.basket_items` to the catalogue/project rows for the display projection,
			// then apply the SAME SSOT arithmetic — not yet implemented; fall back to fixtures.
		}
		return ok(read(query));
	}

	/**
	 * Add a purchasable to a basket. A `null` `basketId` lands in the owner's default basket, so an
	 * add-to-basket from anywhere on the platform needs no prior lookup.
	 */
	static addItem(input: AddBasketItem, query: BasketQuery): ServiceResult<BasketWritePayload> {
		return fromOutcome(fx.addItem(input, query), query);
	}

	/** Patch one line — quantity, selection, parking, delivery address, slot, stage or seats. */
	static updateItem(
		input: UpdateBasketItem,
		query: BasketQuery,
	): ServiceResult<BasketWritePayload> {
		return fromOutcome(fx.updateItem(input, query), query);
	}

	/** Remove a line outright. Soft — the row is stamped, never destroyed (root CLAUDE.md §5). */
	static removeItem(
		input: RemoveBasketItem,
		query: BasketQuery,
	): ServiceResult<BasketWritePayload> {
		return fromOutcome(fx.removeItem(input, query), query);
	}

	/** Move a line between baskets and/or park it into saved-for-later. */
	static moveItem(input: MoveBasketItem, query: BasketQuery): ServiceResult<BasketWritePayload> {
		return fromOutcome(fx.moveItem(input, query), query);
	}

	/**
	 * Attach (or clear, with a `null` code) a promotional code. The saving is resolved against the
	 * basket's current lines and clamped by the SSOT's {@link applyDiscounts}, so a code worth more than
	 * the basket reduces it to zero rather than minting a credit.
	 */
	static applyPromo(input: ApplyPromoCode, query: BasketQuery): ServiceResult<BasketWritePayload> {
		return fromOutcome(fx.applyPromo(input.basketId, input.code, query), query);
	}

	/** Create a further named basket for the owner. */
	static createBasket(
		input: CreateBasketInput,
		query: BasketQuery,
	): ServiceResult<BasketWritePayload> {
		return fromOutcome(fx.createBasket(input.name, query), query);
	}
}

// #region Internals
/** Build the read payload for a query — the shape both `get` and every write answer with. */
function read(query: BasketQuery): BasketReadPayload {
	const owner = fx.resolveOwner(query);
	const basket = fx.basketFor(owner, query.basketId);
	const code = fx.activePromoCode(owner, query.basketId);
	return {
		baskets: fx.listBaskets(query),
		basket,
		promo: fx.resolvePromo(code, basket.items, owner.display),
	};
}

/**
 * Fold a fixtures {@link fx.MutationOutcome} into a {@link ServiceResult}, re-reading the owner's list
 * and promo so a write answers with exactly the same shape as a read — the client replaces its state
 * wholesale and never patches a total by hand.
 */
function fromOutcome(
	out: fx.MutationOutcome,
	query: BasketQuery,
): ServiceResult<BasketWritePayload> {
	if (!out.ok || !out.basket) return fail(out.status ?? 422, { message: out.message });
	const owner = fx.resolveOwner(query);
	// A promo the write itself resolved is passed straight through — including a REFUSED one, so the
	// surface can render "we don't recognise that code" against the field the buyer typed into. Only a
	// write that did not touch the promo re-reads the basket's attached code.
	const promo = out.promo !== undefined
		? out.promo
		: fx.resolvePromo(fx.activePromoCode(owner, out.basket.id), out.basket.items, owner.display);
	return ok({
		baskets: fx.listBaskets({ ...query, basketId: out.basket.id }),
		basket: out.basket,
		promo,
	}, { message: out.message });
}
// #endregion
