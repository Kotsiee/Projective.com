import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DisputeQueueQuerySchema, OpenTicketDisputeInputSchema } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `GET /api/finance/disputes[?status=open|awaiting_response|under_review]` — the operator queue
 * (Decision #212): every live dispute, oldest-due first, with the live set's counts. A platform
 * operator only — `finance.list_disputes_for_review` refuses anyone else with 403.
 *
 * `POST /api/finance/disputes` `{ ticketId, stageId, reason, statement, fileIds? }` — either side raises a
 * dispute on a ticket's money on one stage (`finance.open_ticket_dispute`, PROJECTS EX2). 404 for anyone
 * who is neither side; 409 when nothing there can be disputed now or a case already stands.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const status = ctx.url.searchParams.get("status");
		const parsed = DisputeQueueQuerySchema.safeParse({ status: status || undefined });
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await DisputeBackendService.queue(parsed.data, readActor(ctx)));
	},
	async POST(ctx) {
		const parsed = OpenTicketDisputeInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await DisputeBackendService.open(parsed.data, readActor(ctx)));
	},
});
