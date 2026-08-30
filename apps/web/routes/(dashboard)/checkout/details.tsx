import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { canSkipDetails } from "@projective/types/finance";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";
import { define } from "@web/utils/state.ts";
import CheckoutDetailsScreen from "@features/checkout/islands/CheckoutDetailsScreen.island.tsx";
import { checkoutStepHref } from "@features/checkout/core/basket-model.ts";
import { resolveCheckoutSession } from "@features/checkout/core/checkout-ssr.ts";
import type { DetailsDepartments } from "@features/checkout/core/details-draft.ts";

/**
 * `/checkout/details` — step 2: where the work goes, and who is invoiced for it.
 *
 * Thin controller. The buyer record, every identity they may bill through and the monthly-invoicing
 * offer all arrive on the session projection the fat service already resolves for this basket, so
 * the form SSR-paints filled rather than fetching itself into existence.
 *
 * ## The auto-skip, and why `?edit=1` is mandatory
 *
 * A buyer whose details are already complete is sent straight to Payment: asking someone to re-enter
 * an address they saved last week is the friction this step exists to remove exactly once. The test
 * is `canSkipDetails`, which delegates to `buyerDetailsComplete` — the SAME predicate the payment
 * step's backward gate uses, so a session that may skip the form is a session that may pay and the
 * two cannot disagree.
 *
 * That skip also makes the form unreachable by ordinary navigation, which is why `?edit=1` is a
 * requirement rather than polish: without it a buyer who wants to change a saved address has no way
 * back in, because every route into this page redirects away from it. The payment step's "Change
 * details" link and the stepper's Details anchor both carry it.
 *
 * **The whole query string survives the hop.** `?basket=` and `?owner=` are load-bearing — dropping
 * them lands an entity buyer on their personal basket — and the `sim*` dev axes are the reason the
 * buyer is on this branch at all; a redirect that dropped them would send a developer to a page
 * simulating something else, which is Decision #67's plumbed-and-dropped defect wearing a redirect.
 *
 * **A `Response` returned from a `define.page` component is dead code** — it is a render function,
 * not a handler, and a whole surface has already been lost to that mistake in this codebase. The
 * redirect below is therefore returned from `define.handlers`.
 *
 * No hard capability guard: the `(dashboard)` middleware bounces guests and the deferred `finance.*`
 * RLS is the real gate. A server-side capability bounce would also make half the Dev Context
 * Switcher's personas unreachable, since the server never sees the client seam.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const bootstrap = resolveCheckoutSession(context, ctx.url);

		const editing = ctx.url.searchParams.has("edit");
		if (!editing && canSkipDetails(bootstrap.session)) {
			// Derived from the step vocabulary rather than written out, so there is one place the
			// payment step's path is spelled; the search string is carried across verbatim.
			const target = new URL(ctx.url);
			target.pathname = new URL(checkoutStepHref("payment"), ctx.url).pathname;
			return new Response(null, {
				status: 302,
				headers: { location: `${target.pathname}${target.search}` },
			});
		}

		/**
		 * The departments each billing identity declares, resolved server-side because that is the
		 * entity's fact rather than the buyer's. An identity with none yields an empty list, which the
		 * form renders as absence — an entity with no departments is a real state, not a blank field.
		 *
		 * Read through the fat service rather than from the fixture module. This route previously
		 * imported `departmentsFor` from `buyer-fixtures.ts` directly — the only place in the app that
		 * did — which compiled and rendered correctly while bypassing `isFinanceBackendLive()`
		 * entirely, so this one field would have kept serving fixtures after the finance backend went
		 * live and `USE_MOCKS` could never have reached it.
		 */
		const resolved = CheckoutBackendService.departments(
			basketQueryFrom(ctx.url.searchParams, context),
		);
		const departments: DetailsDepartments = resolved.data?.departments ?? {};

		ctx.state.title = "Delivery & billing · Checkout · Projective";
		return page({ bootstrap, departments });
	},
});

export default define.page<typeof handler>(function CheckoutDetailsPage({ data }) {
	return (
		<CheckoutDetailsScreen
			session={data.bootstrap.session}
			owner={data.bootstrap.owner}
			display={data.bootstrap.display}
			departments={data.departments}
			addBusinessHref="/businesses/create"
		/>
	);
});
