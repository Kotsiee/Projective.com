import { define } from "@web/utils/state.ts";
import {
	CancelOrderLineInputSchema,
	ReportOrderProblemInputSchema,
} from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/checkout/orders/[entitlement]/problem` `{ reason, statement, fileIds? }` — report a
 * downloaded digital product whose files didn't arrive whole or are faulty, while its sale clears (FBP
 * DB21, ROUTING.md). The purchase is named by its entitlement's opaque slug (`ent-…`, Decision #88).
 * Thin: Zod on the slug and the body, then {@link DisputeBackendService.reportOrderProblem}, which passes
 * the money switch and calls `finance.open_order_line_dispute` as the signed-in caller; the door decides
 * who may report, and when.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const slug = CancelOrderLineInputSchema.safeParse({ entitlement: ctx.params.entitlement });
		if (!slug.success) return invalidPayload(slug.error);
		let raw: unknown;
		try {
			raw = await ctx.req.json();
		} catch {
			return malformedBody();
		}
		const body = ReportOrderProblemInputSchema.safeParse(raw);
		if (!body.success) return invalidPayload(body.error);
		return toCheckoutResponse(
			await DisputeBackendService.reportOrderProblem(
				slug.data.entitlement,
				body.data,
				readActor(ctx),
			),
		);
	},
});
