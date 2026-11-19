import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import CheckoutOrdersScreen from "@features/checkout/islands/CheckoutOrdersScreen.island.tsx";
import { resolveOrderHistory } from "@features/checkout/core/checkout-ssr.ts";

/**
 * `/checkout/orders` — every past order of the acting account, newest first (MARKETPLACE CK3,
 * ROUTING.md).
 *
 * Thin controller: `?owner=` scopes it as it scopes the basket, `?after=` / `?before=` name one keyset
 * page boundary the server minted, and `OrderBackendService.history` does the rest. The guest bounce is
 * the `(dashboard)` middleware's; RLS under the caller's JWT is the gate on whose orders are read. Not a
 * checkout step: it runs in the confirmation step's full chrome (`checkoutStepOf`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const history = await resolveOrderHistory(context, ctx.url, readActor(ctx));
		ctx.state.title = history
			? `Orders · ${history.ownerName} · Projective`
			: "Orders · Projective";
		return page({ history });
	},
});

export default define.page<typeof handler>(function CheckoutOrdersPage({ data }) {
	return <CheckoutOrdersScreen initial={data.history} />;
});
