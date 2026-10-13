import { define } from "@web/utils/state.ts";
import { StageFundingQuoteQuerySchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { StageFundingBackendService } from "@server/services/finance/stage-funding.ts";

/**
 * `GET /api/finance/escrow/quote?project=prj-…&stage=stg-…` — what funding one stage takes for the
 * caller (Decision #197): its unfunded tickets at their prices, any still unpriced, and the wallet the
 * escrow is held from with its balance. Thin: Zod-validate the query and delegate; the database applies
 * the payer rule, and `fund_stage` / `begin_card_payment` re-check everything at the commit.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const url = new URL(ctx.req.url);
		const parsed = StageFundingQuoteQuerySchema.safeParse({
			project: url.searchParams.get("project") ?? "",
			stage: url.searchParams.get("stage") ?? "",
		});
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await StageFundingBackendService.quote(parsed.data, readActor(ctx)));
	},
});
