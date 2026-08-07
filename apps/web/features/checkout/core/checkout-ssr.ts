import type { UserContext } from "@projective/types/auth";
import { BasketBackendService } from "@server/services/finance/BasketBackendService.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { CardsBackendService } from "@server/services/finance/CardsBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";
import { defaultOwnerParam } from "./basket-model.ts";
import type { BasketBootstrap, CheckoutBootstrap, SavedCard } from "../types/checkout-types.ts";

/**
 * checkout-ssr — the server-only bootstraps for the `/basket` + `/checkout` first paint.
 *
 * They call the fat services DIRECTLY (no HTTP hop), so the lane, the bands and the body all ship their
 * first byte already resolved against the acting account's basket; the islands then refine through the
 * thin `BasketService` / `CheckoutService`. Mirrors `wallet-ssr` / `catalogue-ssr`.
 *
 * Every resolver is SYNCHRONOUS, which is not incidental: the slot resolvers in
 * `(dashboard)/_layout.tsx` are synchronous functions whose return value goes straight into the render
 * tree, and Preact cannot render a promise. The fat basket services are synchronous today, so the lane
 * can be painted with real data rather than fetching its own (the compromise `/files` had to make).
 *
 * Simulation knobs are ABSENT on the first byte — the server never sees the client dev seam — and are
 * applied on the island's first refetch. Never imported by an island.
 */

/** Resolve the acting owner scope for a request: an explicit `?owner=`, else the active context's. */
export function resolveOwnerParam(context: UserContext, url: URL): string {
	return url.searchParams.get("owner") ?? defaultOwnerParam(context);
}

/**
 * Resolve the `/basket` bootstrap: the open basket, its siblings, and any attached promo.
 *
 * A failed read degrades to a coherent EMPTY basket rather than to nothing, so the route still paints a
 * complete surface with its empty state — a blank region would read as a broken page, and on a basket
 * that means "your items are gone".
 */
export function resolveBasket(context: UserContext, url: URL): BasketBootstrap {
	const query = basketQueryFrom(url.searchParams, context);
	const owner = resolveOwnerParam(context, url);
	const res = BasketBackendService.get(query);
	if (!res.ok || !res.data) {
		const display = (url.searchParams.get("display") ?? "GBP").toUpperCase();
		return { basket: emptyBasket(display), baskets: [], promo: null, owner, display };
	}
	return {
		basket: res.data.basket,
		baskets: res.data.baskets,
		promo: res.data.promo,
		owner,
		display: res.data.basket.currency,
	};
}

/** Resolve just the account's basket list — the lane's switcher on a `/checkout` route. */
export function resolveBasketSummaries(context: UserContext, url: URL): BasketBootstrap["baskets"] {
	const res = BasketBackendService.list(basketQueryFrom(url.searchParams, context));
	return res.ok && res.data ? res.data.baskets : [];
}

/**
 * Resolve the `/checkout` bootstrap: the whole session projection plus the account's baskets.
 *
 * A failed session degrades to an EMPTY projection carrying a single `empty` blocker, because the one
 * thing a checkout must never do is render a Pay control it cannot explain the state of.
 */
export function resolveCheckoutSession(context: UserContext, url: URL): CheckoutBootstrap {
	const query = basketQueryFrom(url.searchParams, context);
	const owner = resolveOwnerParam(context, url);
	const baskets = resolveBasketSummaries(context, url);
	const res = CheckoutBackendService.session(query);
	if (!res.ok || !res.data) {
		const display = (url.searchParams.get("display") ?? "GBP").toUpperCase();
		return { session: emptySession(display), baskets, owner, display };
	}
	return { session: res.data.session, baskets, owner, display: res.data.session.currency };
}

/** Resolve the acting account's saved cards (the checkout's instrument picker). */
export function resolveCards(
	context: UserContext,
	url: URL,
): { cards: SavedCard[]; defaultCardId: string | null } {
	const res = CardsBackendService.list(basketQueryFrom(url.searchParams, context));
	return res.ok && res.data
		? { cards: res.data.cards, defaultCardId: res.data.defaultCardId }
		: { cards: [], defaultCardId: null };
}

// #region Degraded fallbacks (a coherent first paint, never a blank region)
/** A zero `MoneyView` in a currency — the only figure this module ever constructs. */
function zero(display: string): BasketBootstrap["basket"]["subtotal"] {
	return { minor: 0, currency: display, display: "—", origin: null };
}

/** An empty basket that renders as an empty basket, not as a broken page. */
function emptyBasket(display: string): BasketBootstrap["basket"] {
	const now = new Date(0).toISOString();
	return {
		id: "",
		ownerType: "user",
		ownerId: "",
		name: "Basket",
		isDefault: true,
		currency: display,
		items: [],
		groups: [],
		subtotal: zero(display),
		creatorDiscounts: zero(display),
		net: zero(display),
		itemCount: 0,
		selectedCount: 0,
		savedForLaterCount: 0,
		unavailableCount: 0,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * An empty checkout projection.
 *
 * Every provider is omitted rather than fabricated as unavailable: the offer is the server's to state,
 * and inventing six refusals with invented reasons would be worse than an honest "nothing to pay for".
 * The single `empty` blocker is the true reason Pay is closed in this state.
 */
function emptySession(display: string): CheckoutBootstrap["session"] {
	return {
		basketId: "",
		owner: {
			ownerType: "user",
			ownerId: "",
			name: "Your account",
			handle: null,
			avatar: null,
			actingIsMember: true,
		},
		currency: display,
		items: [],
		groups: [],
		preselect: { projectId: null, serviceId: null },
		provider: null,
		providers: [],
		wallet: { available: zero(display), shortfall: zero(display), covers: false },
		savedCards: [],
		defaultCardId: null,
		promo: null,
		totals: {
			subtotal: zero(display),
			creatorDiscounts: zero(display),
			promoDiscount: zero(display),
			net: zero(display),
			platformFee: zero(display),
			platformFeeBp: 0,
			platformFeeMode: "seller_deducted",
			taxes: zero(display),
			taxNote: null,
			total: zero(display),
		},
		requiresEmail: false,
		requiresSchedule: false,
		requiresStage: false,
		blockers: [{
			code: "empty",
			message: "There's nothing to pay for yet. Add something to your basket to continue.",
			itemId: null,
		}],
	};
}
// #endregion
