import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toCheckoutResponse } from "@features/checkout/core/respond.ts";
import { BasketBackendService } from "@server/services/finance/BasketBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/basket/owners?display=` — every account the caller can buy for, each with its baskets and
 * lists, item counts and selected subtotals: the basket switcher's model.
 *
 * Thin: resolve the acting context + session and delegate. Which owners appear is decided by the
 * database (`finance.list_purchase_owners` and its spend predicate), never by a request field.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			await BasketBackendService.owners(
				basketQueryFrom(ctx.url.searchParams, context),
				readActor(ctx),
			),
		);
	},
});
