import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import CheckoutBasketScreen from "@features/checkout/islands/CheckoutBasketScreen.island.tsx";
import { resolveBasket, resolveCheckoutSession } from "@features/checkout/core/checkout-ssr.ts";

/**
 * `/checkout` — **step 1 of four**: the basket and the buyer's lists.
 *
 * This is the flow's first step, not a separate surface: `/basket` now redirects here, `basketHref()`
 * points here, and the stepper's first anchor is this path. Two URLs for one surface is two places a
 * link can rot.
 *
 * Thin controller. The guest bounce is the `(dashboard)` middleware's job, and the basket is resolved
 * from the active context (or an explicit `?owner=` / `?basket=` override) so the correct
 * personal/team/business basket SSR-paints in the first byte. The lane (the list explorer), the header
 * band (the stepper) and the footer band (the selection rig) are resolved separately by their own slot
 * resolvers in the dashboard layout — this route owns the BODY only, which is the region contract
 * working as intended.
 *
 * The checkout session is resolved alongside the basket for ONE field: the voluntary gateway-fee
 * contribution, which is the only thing on this step whose answer comes from the payment projection
 * rather than from the basket. It is passed as that field alone rather than as the whole session, so
 * this step cannot start rendering totals that are only settled once a payment route is chosen.
 *
 * No hard capability guard: the basket is chrome plus the deferred `finance.*` RLS, like every sibling
 * read. A server-side capability bounce would also make half the Dev Context Switcher's personas
 * unreachable, since the server never sees the client seam.
 *
 * **A `Response` returned from a `define.page` component is dead code** — it is a render function, not
 * a handler. Any future redirect on this route (a retired basket id, a scope the viewer lost access to)
 * must be returned from `define.handlers` below, which is where a previous pass lost a whole page to a
 * redirect that silently never fired.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const bootstrap = resolveBasket(context, ctx.url);
		const { session } = resolveCheckoutSession(context, ctx.url);
		ctx.state.title = "Basket · Projective";
		return page({ bootstrap, processingOffer: session.processingOffer });
	},
});

export default define.page<typeof handler>(function CheckoutBasketPage({ data }) {
	return (
		<CheckoutBasketScreen
			initial={data.bootstrap}
			processingOffer={data.processingOffer}
		/>
	);
});
