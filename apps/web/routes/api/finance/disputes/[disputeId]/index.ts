import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/finance/disputes/[disputeId]` — the case as the caller may see it (Decision #212): a party
 * (claimant or respondent) or a platform operator; 404 for anyone else (`finance.get_dispute`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = ctx.params.disputeId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.get(id, readActor(ctx)));
	},
});
