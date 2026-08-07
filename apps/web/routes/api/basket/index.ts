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

/**
 * `/api/basket` — the basket collection.
 *
 * `GET ?basketId=&owner=&display=&project_id=&service_id=&persona=&workspaceRole=&kyb=&acting=`
 * resolves the acting account's baskets AND the one the query targets (both in one round trip, because
 * the surface renders both), with every total server-computed. `POST` creates a further named basket.
 *
 * Thin: parse + Zod-validate + resolve the acting context + delegate to the fat
 * {@link BasketBackendService}. No business logic, no money math, no capability guard — the Dev Context
 * Switcher is client-side and must reach every persona, so a server-side capability bounce would make
 * half the personas unreachable; the acting context here is chrome-only and the deferred `finance.*`
 * RLS is the real gate (consistent with every sibling `/api/*` route).
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		// One read answers with BOTH the account's basket list and the resolved basket — the surface
		// renders the switcher and the basket together, so a second round trip would only add a window
		// in which the two disagree.
		return toCheckoutResponse(
			BasketBackendService.get(basketQueryFrom(ctx.url.searchParams, context)),
		);
	},

	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = CreateBasketSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			BasketBackendService.createBasket(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},
});
