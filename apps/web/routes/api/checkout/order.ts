import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toCheckoutResponse } from "@features/checkout/core/respond.ts";
import { OrderBackendService } from "@server/services/finance/OrderBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/checkout/order?order=&owner=` — the confirmation hub's whole read: the resolved order and
 * the account's other recent ones.
 *
 * `?order=` names one; without it the account's most recent is returned, which is what keeps the page
 * usable from a link that has lost its query string. An order belonging to a different account is
 * never returned even when its id is named — the fat service scopes it — because an id in a URL is a
 * guess anyone can make and a receipt carries an address, a company registration and a card fragment.
 *
 * **A GET, deliberately, and never a re-POST of the charge.** The order was written once, by
 * `/api/checkout/create`, at the moment the payment was made, so re-submitting it from a confirmation
 * page would be a second charge.
 *
 * Thin: resolve the acting context, the session and the query, then delegate to the fat
 * {@link OrderBackendService}, which reads as the signed-in caller — `finance.orders` RLS is the gate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		return toCheckoutResponse(
			await OrderBackendService.get({
				...basketQueryFrom(sp, context),
				orderId: sp.get("order"),
			}, readActor(ctx)),
		);
	},
});
