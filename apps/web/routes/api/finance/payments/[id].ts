import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/finance/payments/[id]` — where one card payment stands, for a surface waiting on it (a
 * top-up dialog, a card checkout). `succeeded` only once the signed webhook has credited the wallet;
 * the row is readable by whoever can read its wallet (RLS), and a stranger gets a 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = ctx.params.id;
		if (!UUID_RE.test(id)) {
			return Response.json({ ok: false, message: "That payment wasn't found." }, { status: 404 });
		}
		return toPaymentsResponse(await PaymentBackendService.paymentStatus(id, readActor(ctx)));
	},
});
