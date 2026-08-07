import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import BasketHeaderBand from "../islands/BasketHeaderBand.island.tsx";
import { checkoutViewOf, isCheckoutPath } from "./basket-model.ts";
import { resolveBasket, resolveCheckoutSession } from "./checkout-ssr.ts";

/**
 * basket-header-slot — the middle-nav HEADER band on every `/basket` and `/checkout` route.
 *
 * The band answers identity, narrowing and currency, and — below 767px, where the lane is removed — it
 * inherits the lane's navigation duty. That inheritance is why it resolves the account's baskets even
 * on a route where the lane is present: the band must paint the full switcher in its first byte at any
 * width, and a control that appeared only after a client measurement would be missing at exactly the
 * moment it is the only one there.
 *
 * **The identity comes from the CHECKOUT session on both routes**, not from the basket. A `Basket`
 * carries an `ownerType` and an `ownerId` but no display name, handle or avatar — the resolved owner is
 * a checkout fact. Reading it from one place means the account named above a basket and the account
 * named above the payment for it can never differ, which on a shared entity basket is the difference
 * between "whose money is this" being answered and being guessed.
 *
 * Composed after the projects/messaging/catalogue/wallet resolvers in `middleNavHeaderFor`, so exactly
 * one owns the band per URL. Server-only — never imported by an island.
 */
export function basketHeaderFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;

	const { basket, baskets, owner, display } = resolveBasket(context, url);
	const checkout = resolveCheckoutSession(context, url);

	return (
		<BasketHeaderBand
			owner={checkout.session.owner}
			ownerParam={owner}
			basketName={basket.name}
			basketId={basket.id || null}
			baskets={baskets}
			view={checkoutViewOf(url.pathname)}
			display={display}
		/>
	);
}
