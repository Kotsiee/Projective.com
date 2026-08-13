import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { buyerDetailsComplete } from "@projective/types/finance";
import { define } from "@web/utils/state.ts";
import CheckoutPaymentScreen from "@features/checkout/islands/CheckoutPaymentScreen.island.tsx";
import { checkoutStepHref, preselectFrom } from "@features/checkout/core/basket-model.ts";
import { resolveCards, resolveCheckoutSession } from "@features/checkout/core/checkout-ssr.ts";

/**
 * `/checkout/payment` — step 3: which instrument, what it costs, and the commit.
 *
 * Thin controller. The whole projection the page renders — which account is paying, every payment
 * route with a reason on each refusal, what the wallet covers, the saved cards, the spending-limit
 * verdict, the gateway-contribution offer, the server-computed totals and everything currently
 * blocking Pay — is resolved synchronously from the fat services, so the first byte carries a
 * complete and honest state rather than a Pay button whose availability arrives later.
 *
 * ## The backward gate
 *
 * A buyer who deep-links here without complete delivery and billing details is sent back to step 2.
 * That is the mirror of the Details step's auto-skip, and the two use the SAME predicate —
 * `buyerDetailsComplete` — precisely so they cannot disagree: a session that may skip the form is a
 * session that may pay, and a session that may not skip it must not be shown a Pay button the server
 * is going to refuse. One predicate governs both directions.
 *
 * **A `Response` returned from a `define.page` component is dead code** — it is a render function,
 * not a handler, and a whole surface has already been lost to that mistake in this codebase. The
 * redirect below is therefore returned from `define.handlers`.
 *
 * No hard capability guard: the member gate, the KYB gate, the provider rules and the instrument
 * checks are ALL enforced by the fat service, and refusing here as well would be a second copy of
 * rules that must not be able to disagree. The `(dashboard)` middleware bounces guests and the
 * deferred `finance.*` RLS is the real gate.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const bootstrap = resolveCheckoutSession(context, ctx.url);

		if (!buyerDetailsComplete(bootstrap.session.buyer)) {
			const sp = ctx.url.searchParams;
			const location = checkoutStepHref(
				"details",
				bootstrap.session.basketId || sp.get("basket"),
				bootstrap.owner,
				preselectFrom(sp),
			);
			return new Response(null, { status: 302, headers: { location } });
		}

		const { cards, defaultCardId } = resolveCards(context, ctx.url);
		ctx.state.title = "Payment · Projective";
		return page({ bootstrap, cards, defaultCardId });
	},
});

export default define.page<typeof handler>(function CheckoutPaymentPage({ data }) {
	return (
		<CheckoutPaymentScreen
			initial={data.bootstrap}
			cards={data.cards}
			defaultCardId={data.defaultCardId}
		/>
	);
});
