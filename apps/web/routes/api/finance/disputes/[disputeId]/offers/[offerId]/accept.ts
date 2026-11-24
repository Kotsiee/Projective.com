import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { uuid } from "@projective/types/finance";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `POST /api/finance/disputes/[disputeId]/offers/[offerId]/accept` — the other side accepts the standing
 * offer, and the case settles at once on its terms (`finance.accept_dispute_offer`, PROJECTS EX2). The
 * definer re-checks that the offer still stands and belongs to the case's other side.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const dispute = uuid.safeParse(ctx.params.disputeId);
		const offer = uuid.safeParse(ctx.params.offerId);
		if (!dispute.success || !offer.success) {
			return Response.json({ ok: false, message: "Unknown offer." }, { status: 404 });
		}
		return toPaymentsResponse(await DisputeBackendService.accept(offer.data, readActor(ctx)));
	},
});
