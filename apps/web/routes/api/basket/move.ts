import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { MoveBasketItemSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { BasketBackendService } from "@server/services/finance/BasketBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/basket/move` — move a line between baskets, reorder it, and/or park it into
 * saved-for-later ({@link MoveBasketItemSchema}). A `null` `toBasketId` moves it to the acting
 * account's default basket.
 *
 * Nothing is removed by a move: parking a line leaves it in its basket, it just stops queueing for
 * payment (root CLAUDE.md §5). Thin: parse + Zod-validate + resolve the acting context and session +
 * delegate to the fat {@link BasketBackendService}, which writes as the signed-in caller — `finance.*`
 * RLS and its spend predicate are the gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = MoveBasketItemSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await BasketBackendService.moveItem(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
