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
import { promoThrottle, retryAfterSeconds } from "@server/services/finance/promo-throttle.ts";
import { readActor } from "@web/utils/api-session.ts";
import { clientKey } from "@web/utils/client-key.ts";

/**
 * `POST /api/basket/promo` — attach a promotional code to a whole basket, or clear it with
 * `code: null` ({@link ApplyPromoCodeSchema}).
 *
 * The saving is resolved SERVER-side against the basket's current lines and clamped by the SSOT's
 * `applyDiscounts`, so a code worth more than the basket reduces it to zero rather than minting a
 * credit. A refused code still comes back as a resolved `promo` carrying its reason — the surface must
 * be able to say *why* it did not apply, not merely fail to change the total.
 *
 * An attempt that names a code is throttled per account and per client address ({@link promoThrottle},
 * FINANCE_AUDIT CO22): past the ceiling it is a 429 with `Retry-After`, so a burst cannot enumerate
 * codes. Clearing a code is never throttled.
 *
 * Thin: parse + Zod-validate + throttle + resolve the acting context and session + delegate. The fat
 * service writes as the signed-in caller, so `finance.*` RLS and its spend predicate are the gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = ApplyPromoCodeSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		const actor = readActor(ctx);
		if (parsed.data.code !== null) {
			const refused = promoThrottle.admit({
				account: actor.userId ?? "signed-out",
				clientKey: clientKey(ctx.info.remoteAddr, ctx.req.headers),
			});
			if (refused) {
				const res = toCheckoutResponse(refused);
				res.headers.set("retry-after", String(retryAfterSeconds(refused)));
				return res;
			}
		}
		return toCheckoutResponse(
			await BasketBackendService.applyPromo(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				actor,
			),
		);
	},
});
