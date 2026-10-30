import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `GET /api/finance/disputes/[disputeId]` — the case as the caller may see it (Decision #212): a party
 * (claimant or respondent) or a platform operator; 404 for anyone else (`finance.get_dispute`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.disputeId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.get(id.data, readActor(ctx)));
	},
});
