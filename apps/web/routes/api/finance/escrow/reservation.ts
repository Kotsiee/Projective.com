import { define } from "@web/utils/state.ts";
import { ReservationRefundBodySchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { StageFundingBackendService } from "@server/services/finance/stage-funding.ts";

/**
 * `POST /api/finance/escrow/reservation` — the payer takes one prepaid stage of a ticket back while the
 * ticket has not reached it (Decision #556 (d)).
 *
 * Thin: Zod-validate the body and delegate. `projects.refund_ticket_stage_reservation` checks the payer
 * (`fn_can_fund_project`), locks the ticket and refunds the stage's reservation to the paying wallet in
 * one transaction; a stage that is no longer only prepaid answers 409.
 *
 * Body: `{ project: "prj-…", ticket: "tkt-…", stageId }`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = ReservationRefundBodySchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await StageFundingBackendService.refundReservation(parsed.data, readActor(ctx)),
		);
	},
});
