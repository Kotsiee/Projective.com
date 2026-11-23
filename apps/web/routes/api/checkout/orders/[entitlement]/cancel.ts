import { define } from "@web/utils/state.ts";
import { CancelOrderLineInputSchema } from "@projective/types/finance";
import { invalidPayload, toCheckoutResponse } from "@features/checkout/core/respond.ts";
import { OrderBackendService } from "@server/services/finance/OrderBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/checkout/orders/[entitlement]/cancel` — cancel a digital product purchase while its sale
 * is still clearing (FBP DB21, ROUTING.md). The purchase is named by its entitlement's opaque slug
 * (`ent-…`, Decision #88), the handle its downloads already use. Thin: Zod on the slug, then
 * {@link OrderBackendService.cancelLine}, which passes the money switch and calls
 * `finance.cancel_order_line` as the signed-in caller; the door decides who may cancel and when.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = CancelOrderLineInputSchema.safeParse({ entitlement: ctx.params.entitlement });
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await OrderBackendService.cancelLine(parsed.data.entitlement, readActor(ctx)),
		);
	},
});
