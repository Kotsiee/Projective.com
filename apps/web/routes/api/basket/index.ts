import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import {
	BasketBackendService,
	CreateBasketSchema,
} from "@server/services/finance/BasketBackendService.ts";
import { basketQueryFrom, basketQueryFromBody } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `/api/basket` — the basket collection.
 *
 * `GET ?basketId=&owner=&display=&project_id=&service_id=` resolves the acting account's baskets AND
 * the one the query targets (both in one round trip, because the surface renders both), with every
 * total server-computed. `POST` creates a further named basket.
 *
 * Thin: parse + Zod-validate + resolve the acting context and session + delegate to the fat
 * {@link BasketBackendService}. No business logic, no money math. The fat service reads and writes as
 * the signed-in caller, so `finance.*` RLS is the gate; a guest is answered 401.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			await BasketBackendService.get(basketQueryFrom(ctx.url.searchParams, context), readActor(ctx)),
		);
	},

	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = CreateBasketSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await BasketBackendService.createBasket(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
