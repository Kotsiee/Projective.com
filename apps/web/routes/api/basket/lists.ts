import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { CreateBasketListSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { BasketBackendService } from "@server/services/finance/BasketBackendService.ts";
import { basketQueryFrom, basketQueryFromBody } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `/api/basket/lists` — the basket lane's navigation model.
 *
 * `GET ?basket=&list=&owner=&display=` returns the account's named lists (default first, the parked
 * shelf trailing) plus the engagement-derived Tickets and Sessions groups over the active basket, each
 * with a SERVER-computed subtotal. `POST` creates a further named list — simply a non-default
 * `finance.baskets` row — and answers with the refreshed model with that list already active, so the
 * lane needs no second read to find where the thing it just made landed.
 *
 * `?list=` names the entry the URL addresses, so the lane paints its active row on the first byte.
 *
 * Thin: parse + Zod-validate + resolve the acting context and session + delegate to the fat
 * {@link BasketBackendService}, which reads and writes as the signed-in caller.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		return toCheckoutResponse(
			await BasketBackendService.lists(basketQueryFrom(sp, context), readActor(ctx), sp.get("list")),
		);
	},

	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = CreateBasketListSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await BasketBackendService.createList(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
