import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `GET /api/finance/payments/[id]` — where one card payment stands, for a surface waiting on it (a
 * top-up dialog, a card checkout). `succeeded` only once the signed webhook has credited the wallet;
 * the row is readable by whoever can read its wallet (RLS), and a stranger gets a 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.id);
		if (!id.success) {
			return Response.json({ ok: false, message: "That payment wasn't found." }, { status: 404 });
		}
		return toPaymentsResponse(await PaymentBackendService.paymentStatus(id.data, readActor(ctx)));
	},
});
