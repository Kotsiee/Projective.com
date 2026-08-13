import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import CheckoutConfirmationScreen from "@features/checkout/islands/CheckoutConfirmationScreen.island.tsx";
import { resolveOrder } from "@features/checkout/core/checkout-ssr.ts";

/**
 * `/checkout/confirmation` — step 4 of the checkout flow: the post-purchase hub.
 *
 * Thin controller. `?order=` names the order to show; without it the resolver falls back to the
 * account's most recent, so the URL a payment lands on and a bookmark of this page both work. The
 * guest bounce is the `(dashboard)` middleware's job and there is no capability guard here, matching
 * every sibling read — the deferred `finance.*` RLS is the real gate, and a server-side capability
 * bounce would make half the Dev Context Switcher's personas unreachable, since the server never sees
 * the client seam.
 *
 * **This step runs in FULL chrome** (the sidebar and the lane return, resolved by
 * `checkoutChromeFor`). Details and Payment suppress them because a buyer mid-commitment should not
 * be pulled sideways; this page is the opposite — its entire job is to send the buyer somewhere, so
 * removing the exits would defeat it.
 *
 * **No order is an empty state, not a redirect.** A buyer who has just paid and is bounced to the
 * basket reads the bounce as the payment having vanished, so the island renders an honest empty
 * branch that offers the way back as a LINK. This is a deliberate departure from the implementation
 * contract's §A.4, which specified a `302` here; it is recorded rather than resolved silently.
 *
 * **A `Response` returned from a `define.page` component is dead code** — it is a render function,
 * not a handler. Any future redirect on this route (a retired order id, an order the viewer lost
 * access to) belongs in `define.handlers` below, which is where a previous pass lost a whole surface
 * to a redirect that silently never fired.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const orderPage = resolveOrder(context, ctx.url);
		ctx.state.title = orderPage
			? `Order ${orderPage.order.reference} · Projective`
			: "Order confirmation · Projective";
		return page({ orderPage });
	},
});

export default define.page<typeof handler>(function CheckoutConfirmationPage({ data }) {
	return <CheckoutConfirmationScreen initial={data.orderPage} />;
});
