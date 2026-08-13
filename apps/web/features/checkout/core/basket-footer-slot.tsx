import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CheckoutFooterRig from "../islands/CheckoutFooterRig.island.tsx";
import { checkoutStepOf, isCheckoutPath } from "./basket-model.ts";
import { resolveBasket, resolveCheckoutSession } from "./checkout-ssr.ts";

/**
 * basket-footer-slot — the middle-nav FOOTER band on **every** checkout route, all four steps.
 *
 * Like `walletFooterFor` and unlike the page-scoped channel/board rigs, this is not narrowed to one
 * page: the footer holds every action on the surface, so a step without it would be a basket with no
 * way forward and a payment with no way to commit.
 *
 * **It resolves exactly one projection per step**, chosen by what the rig's controls actually print:
 *
 * - **Basket** — the basket, for the CTA's running total. Nothing on this step can be blocked, so
 *   there is no session to read.
 * - **Details / Payment** — the session, for the payable total and the blockers. The blockers matter
 *   in the FIRST byte: a Pay control painted live and then disabled is the sequence that teaches a
 *   reader their payment failed when it was never offered.
 * - **Confirmation** — the session too, but only for the acting identity and the currency. There is no
 *   figure to commit to after the purchase, so the rig is passed no total and renders no filled
 *   control.
 *
 * The currency is threaded from the same read the header band uses, deliberately: both bands seed the
 * shared display-currency signal on mount, and two regions seeding it with different values would
 * leave the surface arguing with itself about what the buyer is reading.
 *
 * Composed after the wallet/workspace/files footer resolvers in `middleNavFooterFor`, so exactly one
 * owns the band per URL. Server-only — never imported by an island.
 */
export function basketFooterFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;

	const step = checkoutStepOf(url.pathname);

	if (step === "basket") {
		const { basket, owner, display } = resolveBasket(context, url);
		return (
			<CheckoutFooterRig
				step={step}
				basketId={basket.id || null}
				owner={owner}
				display={display}
				// Server-computed and server-formatted. The rig renders this figure; it never assembles one.
				total={basket.net}
				blocked={false}
			/>
		);
	}

	const { session, owner, display } = resolveCheckoutSession(context, url);
	return (
		<CheckoutFooterRig
			step={step}
			basketId={session.basketId || null}
			owner={owner}
			display={display}
			total={step === "confirmation" ? null : session.totals.total}
			blocked={session.blockers.length > 0}
			orderId={url.searchParams.get("order")}
			// No invoice document is served yet, so the download action is ABSENT rather than offered and
			// refused. It appears the moment a resolver can supply an href.
			invoiceHref={null}
		/>
	);
}
