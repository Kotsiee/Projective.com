import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DisputeResolveInputSchema, uuid } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `POST /api/finance/disputes/[disputeId]/resolve` `{ outcome, payeeShareBp?, notes }` — a platform
 * operator's ruling: release, refund, or a split (`finance.resolve_dispute`, which refuses anyone but
 * `security.is_admin()` with 403). Final.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.disputeId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		const parsed = DisputeResolveInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await DisputeBackendService.resolve(id.data, parsed.data, readActor(ctx)),
		);
	},
});
