import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CheckoutFooterRig from "../islands/CheckoutFooterRig.island.tsx";
import { checkoutStepOf, isCheckoutPath, isFocusStep } from "./basket-model.ts";
import { resolveBasket, resolveCheckoutSession } from "./checkout-ssr.ts";

/**
 * basket-footer-slot — the middle-nav FOOTER band on the checkout's two NON-committing steps.
 *
 * **The two focus steps have no footer band at all**, which is a deliberate narrowing rather than an
 * omission. `/checkout/details` and `/checkout/payment` run in focus chrome (§D.6): the shell already
 * withholds the sidebar, the lane, the header search and `BottomNav` so a buyer mid-commitment is not
 * pulled sideways, and a persistent action strip pinned to the viewport is the last piece of chrome
 * competing with the step's own decision. Both steps carry every action they need inside the content
 * layout and the order-summary rail — Continue and Save details in the form's action row, Buy Now in
 * the rail beside the total it commits to, Change Details in the contract banner — so nothing is lost
 * by removing the band, and the total the buyer agrees to now sits next to the button that agrees to
 * it rather than a screen away from it.
 *
 * That leaves two steps, and this resolves exactly one projection for each, chosen by what the rig's
 * controls actually print:
 *
 * - **Basket** — the basket, for the CTA's running total. Nothing on this step can be blocked, so
 *   there is no session to read.
 * - **Confirmation** — the session, but only for the acting identity and the currency. There is no
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
	// The band is not merely hidden on a focus step — it is never constructed, so the frame does not
	// reserve its row and the body reaches the viewport edge (§D.6's "remove by not constructing").
	if (isFocusStep(step)) return null;

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
			/>
		);
	}

	const { session, owner, display } = resolveCheckoutSession(context, url);
	return (
		<CheckoutFooterRig
			step="confirmation"
			basketId={session.basketId || null}
			owner={owner}
			display={display}
			// Nothing left to commit to once the charge has landed, so the rig renders no filled control.
			total={null}
			orderId={url.searchParams.get("order")}
			// No invoice document is served yet, so the download action is ABSENT rather than offered and
			// refused. It appears the moment a resolver can supply an href.
			invoiceHref={null}
		/>
	);
}
