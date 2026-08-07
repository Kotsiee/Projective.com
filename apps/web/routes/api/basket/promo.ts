import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { ApplyPromoCodeSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { BasketBackendService } from "@server/services/finance/BasketBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";

/**
 * `POST /api/basket/promo` — attach a promotional code to a whole basket, or clear it with
 * `code: null` ({@link ApplyPromoCodeSchema}).
 *
 * The saving is resolved SERVER-side against the basket's current lines and clamped by the SSOT's
 * `applyDiscounts`, so a code worth more than the basket reduces it to zero rather than minting a
 * credit. A refused code still comes back as a resolved `promo` carrying its reason — the surface must
 * be able to say *why* it did not apply, not merely fail to change the total.
 *
 * Thin: parse + Zod-validate + resolve the acting context + delegate. No server capability guard — the
 * Dev Context Switcher must reach every persona; the fat service enforces the member gate and the
 * deferred `finance.*` RLS is the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = ApplyPromoCodeSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			BasketBackendService.applyPromo(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},
});
