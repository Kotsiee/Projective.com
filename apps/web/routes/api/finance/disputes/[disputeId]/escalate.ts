import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/finance/disputes/[disputeId]/escalate` — either party sends an `awaiting_response` case to
 * a Projective auditor before its deadline (`finance.escalate_dispute`).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = ctx.params.disputeId;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.escalate(id, readActor(ctx)));
	},
});
