import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { uuid } from "@projective/types/finance";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `GET /api/finance/disputes/ticket/[ticketId]` — a ticket's dispute state for its reader
 * (`finance.ticket_dispute_state`, PROJECTS EX2): the live case on it, if any, and whether the caller may
 * raise one now on its current stage, so the ticket view offers Raise a dispute only where it works. 404
 * for anyone who is neither side.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.ticketId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown ticket." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.ticketState(id.data, readActor(ctx)));
	},
});
