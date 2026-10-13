import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { FundPaidRevisionSchema } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { RevisionPurchaseBackendService } from "@server/services/finance/revision-purchase.ts";

/**
 * `POST /api/projects/:id/stages/:stageId/submissions/:submissionId/paid-revision/fund` — thin route:
 * pay for a raised paid revision round directly, not through the basket (Decision #199), and delegate
 * to {@link RevisionPurchaseBackendService.fundPaidRevision}.
 *
 * Body: `{ revisionId, method: "wallet" | "card", expectedAmountMinor, currency, idempotencyKey }`.
 * `wallet` answers once the round's escrow is held and the work is sent back; `card` answers with the
 * PaymentIntent handoff, and the signed webhook holds the escrow when the payment settles.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const raw = await readJson(ctx.req);
		const parsed = FundPaidRevisionSchema.safeParse({
			...(typeof raw === "object" && raw !== null ? raw : {}),
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
			submissionId: ctx.params.submissionId,
		});
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await RevisionPurchaseBackendService.fundPaidRevision(parsed.data, readActor(ctx)),
		);
	},
});
