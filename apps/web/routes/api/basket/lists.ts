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

/**
 * `/api/basket/lists` — the basket lane's navigation model.
 *
 * `GET ?basket=&list=&owner=&display=&persona=&workspaceRole=&kyb=&acting=&sim*` returns the account's
 * named lists (default first, the parked shelf trailing) plus the engagement-derived Tickets and
 * Sessions groups over the active basket, each with a SERVER-computed subtotal. `POST` creates a
 * further named list — which is simply a non-default `finance.baskets` row, not a new concept — and
 * answers with the refreshed model with that list already active, so the lane needs no second read to
 * find where the thing it just made landed.
 *
 * `?list=` names the entry the URL addresses, so the lane paints its active row on the first byte.
 *
 * Thin: parse + Zod-validate + resolve the acting context + delegate to the fat
 * {@link BasketBackendService}. No business logic, no money math, no capability guard — the Dev
 * Context Switcher is client-side and must reach every persona, so a server-side capability bounce
 * would make half of them unreachable; the acting context here is chrome-only and the deferred
 * `finance.*` RLS is the real gate (consistent with every sibling `/api/*` route).
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		return toCheckoutResponse(
			BasketBackendService.lists(basketQueryFrom(sp, context), sp.get("list")),
		);
	},

	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = CreateBasketListSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			BasketBackendService.createList(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},
});
