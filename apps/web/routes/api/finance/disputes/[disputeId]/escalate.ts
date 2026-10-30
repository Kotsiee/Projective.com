import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `POST /api/finance/disputes/[disputeId]/escalate` — either party sends an `awaiting_response` case to
 * a Projective auditor before its deadline (`finance.escalate_dispute`).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.disputeId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.escalate(id.data, readActor(ctx)));
	},
});
