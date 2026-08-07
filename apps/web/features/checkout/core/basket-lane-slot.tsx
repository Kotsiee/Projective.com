import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import BasketLane from "../islands/BasketLane.island.tsx";
import { checkoutViewOf, isCheckoutPath } from "./basket-model.ts";
import { resolveBasket } from "./checkout-ssr.ts";

/**
 * basket-lane-slot — the SSR-idiomatic resolver for the middle-nav LANE on any `/basket` or `/checkout`
 * route (mirrors `walletLaneFor` / `catalogueLaneFor`).
 *
 * It covers BOTH routes on purpose. The lane's job is "which basket, and which of the two steps", and
 * that question is live on the checkout page too — a buyer who realises they are paying from the wrong
 * basket must be able to say so without leaving the flow by the back button.
 *
 * It resolves the basket rather than only its summaries because the lane paints two facts that come
 * from the basket itself: the parked-shelf count and the unavailable-line warning. Both are gates a
 * reader acts on, so a lane that painted them a beat late would be a lane that briefly lied.
 *
 * Server-only (reaches `@server/services`); never imported by an island.
 */
export function basketLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;

	const { basket, baskets, owner, display } = resolveBasket(context, url);

	return (
		<BasketLane
			baskets={baskets}
			activeBasketId={basket.id || null}
			owner={owner}
			display={display}
			view={checkoutViewOf(url.pathname)}
			savedForLaterCount={basket.savedForLaterCount}
			unavailableCount={basket.unavailableCount}
		/>
	);
}
