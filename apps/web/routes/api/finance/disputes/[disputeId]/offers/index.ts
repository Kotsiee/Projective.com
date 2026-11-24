import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DisputeOfferInputSchema, uuid } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `POST /api/finance/disputes/[disputeId]/offers` `{ payeeShareBp, note? }` — a party to a live ticket
 * case offers the freelancer's share of the money, 0–10,000 basis points (`finance.propose_dispute_offer`,
 * PROJECTS EX2). The newest offer stands; the other side is told.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.disputeId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown dispute." }, { status: 404 });
		}
		const parsed = DisputeOfferInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await DisputeBackendService.offer(id.data, parsed.data, readActor(ctx)),
		);
	},
});
