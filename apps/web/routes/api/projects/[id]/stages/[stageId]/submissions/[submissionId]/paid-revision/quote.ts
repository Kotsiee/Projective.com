import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { PaidRevisionQuoteQuerySchema } from "@projective/types/finance";
import { invalidBody, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { RevisionPurchaseBackendService } from "@server/services/finance/revision-purchase.ts";

/**
 * `GET /api/projects/:id/stages/:stageId/submissions/:submissionId/paid-revision/quote?revision=<uuid>`
 * `[&pay_in=EUR]` — thin route: what paying for a raised paid revision round charges the caller
 * (Decision #436), in their own currency through locked quotes unless `pay_in` names the project's.
 * Delegates to {@link RevisionPurchaseBackendService.quote}; the fund route re-checks everything.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const url = new URL(ctx.req.url);
		const parsed = PaidRevisionQuoteQuerySchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
			submissionId: ctx.params.submissionId,
			revisionId: url.searchParams.get("revision") ?? "",
			payIn: url.searchParams.get("pay_in") ?? undefined,
		});
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await RevisionPurchaseBackendService.quote(parsed.data, readActor(ctx)),
		);
	},
});
