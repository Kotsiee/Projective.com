import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CheckoutStepperBand from "../islands/CheckoutStepperBand.island.tsx";
import { checkoutStepOf, isCheckoutPath } from "./basket-model.ts";
import { resolveCheckoutSession } from "./checkout-ssr.ts";

/**
 * basket-header-slot — the middle-nav HEADER band on **every** checkout route, all four steps.
 *
 * The band answers identity, progress and currency, and — below 767px, where the lane is removed — it
 * inherits the lane's scope duty. That inheritance is why it resolves the account's baskets even on a
 * route where the lane is present: the band must paint the full switcher in its first byte at any
 * width, and a control that appeared only after a client measurement would be missing at exactly the
 * moment it is the only one there.
 *
 * **One read, not two.** Everything the band needs — the resolved buyer identity, the account's
 * baskets, the open basket's id and the display currency — comes from the checkout session, so the
 * band no longer resolves the basket separately. `Basket` carries an `ownerType` and an `ownerId` but
 * no display name, handle or avatar; the resolved owner is a checkout fact. Reading it from one place
 * means the account named above a basket and the account named above the payment for it can never
 * differ, which on a shared entity basket is the difference between "whose money is this" being
 * answered and being guessed.
 *
 * Composed after the projects/messaging/catalogue/wallet resolvers in `middleNavHeaderFor`, so exactly
 * one owns the band per URL. Server-only — never imported by an island.
 */
export function basketHeaderFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;

	const { session, baskets, owner, display } = resolveCheckoutSession(context, url);
	const basketId = session.basketId || null;
	// The open basket's name lives on its summary row, not on the session. A degraded read has no
	// summaries at all, so the band names the surface rather than inventing a basket.
	const active = basketId
		? baskets.find((entry) => entry.id === basketId)
		: baskets.find((entry) => entry.isDefault);

	return (
		<CheckoutStepperBand
			step={checkoutStepOf(url.pathname)}
			owner={session.owner}
			ownerParam={owner}
			basketName={active?.name ?? "Basket"}
			basketId={basketId}
			baskets={baskets}
			display={display}
			orderId={url.searchParams.get("order")}
		/>
	);
}
