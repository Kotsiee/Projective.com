import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `GET /api/finance/payments/[id]/status` — the poll for a pending escrow-lock card payment: its
 * status beside the funding state it leaves the ticket in (`PaymentFundingPollSchema`, Decision #165).
 * `funded` only once the signed webhook settled it and the escrow is held. Thin: Zod-validate the id
 * and delegate; the service signs the caller in and RLS answers a stranger with a 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.id);
		if (!id.success) {
			return Response.json({ ok: false, message: "That payment wasn't found." }, { status: 404 });
		}
		return toPaymentsResponse(await PaymentBackendService.paymentFunding(id.data, readActor(ctx)));
	},
});
