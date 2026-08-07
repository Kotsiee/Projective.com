import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import CheckoutScreen from "@features/checkout/islands/CheckoutScreen.island.tsx";
import { resolveCheckoutSession } from "@features/checkout/core/checkout-ssr.ts";

/**
 * `/checkout` — the payment step for the acting account's basket.
 *
 * Thin controller. The entire projection the page renders — which account is paying, which lines, all
 * six payment routes with a reason on every refusal, what the wallet covers, the server-computed
 * totals, and everything currently blocking Pay — is one synchronous read from the fat
 * `CheckoutBackendService`, so the page paints a complete and honest state in the first byte rather
 * than a Pay button whose availability arrives later.
 *
 * `?project_id=` / `?service_id=` narrow the payment to one engagement's lines (the SSOT's
 * `CheckoutPreselect`), so "pay for just this project" is a link rather than a mode.
 *
 * No hard capability guard: the member gate, the KYB gate, the provider rules and the instrument checks
 * are ALL enforced by the fat service — refusing here as well would be a second copy of rules that must
 * not be able to disagree. The `(dashboard)` middleware bounces guests and the deferred `finance.*` RLS
 * is the real gate.
 *
 * **A `Response` returned from a `define.page` component is dead code.** Any redirect (an empty basket
 * sent back to `/basket`, a basket that no longer exists) must be returned from `define.handlers`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const bootstrap = resolveCheckoutSession(context, ctx.url);
		ctx.state.title = "Checkout · Projective";
		return page({ bootstrap });
	},
});

export default define.page<typeof handler>(function CheckoutPage({ data }) {
	return <CheckoutScreen initial={data.bootstrap} />;
});
