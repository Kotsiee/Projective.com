import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import BasketFooterRig from "../islands/BasketFooterRig.island.tsx";
import { checkoutViewOf, isCheckoutPath } from "./basket-model.ts";
import { resolveBasket, resolveCheckoutSession } from "./checkout-ssr.ts";

/**
 * basket-footer-slot — the middle-nav FOOTER band on EVERY `/basket` and `/checkout` route.
 *
 * Like `walletFooterFor` and unlike the page-scoped channel/board rigs, this is not narrowed to one
 * page: the footer holds every action on the surface, so a route without it would be a basket with no
 * way to check out and a checkout with no way to pay.
 *
 * It resolves the checkout session even on `/basket` for one reason: the rig's primary control carries
 * the server-formatted TOTAL, and a Checkout button that showed a stale figure — or none — would be
 * asking the buyer to commit to an amount the surface could not state. It also resolves the blockers,
 * so the Pay control is refused in the FIRST byte rather than painted live and then disabled, which is
 * the sequence that teaches a reader their payment failed when it was never offered.
 *
 * Composed after the wallet/workspace/files footer resolvers in `middleNavFooterFor`, so exactly one
 * owns the band per URL. Server-only — never imported by an island.
 */
export function basketFooterFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;

	const view = checkoutViewOf(url.pathname);
	const { basket, owner, display } = resolveBasket(context, url);
	const checkout = resolveCheckoutSession(context, url);

	return (
		<BasketFooterRig
			view={view}
			basketId={basket.id || null}
			owner={owner}
			display={display}
			// Server-computed and server-formatted. The rig prints this string; it never assembles one.
			totalDisplay={view === "checkout"
				? checkout.session.totals.total.display
				: basket.net.display}
			blocked={checkout.session.blockers.length > 0}
		/>
	);
}
