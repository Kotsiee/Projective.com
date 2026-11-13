import { define } from "@web/utils/state.ts";
import { EscrowQuoteQuerySchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { StageFundingBackendService } from "@server/services/finance/stage-funding.ts";

/**
 * `GET /api/finance/escrow/quote?project=prj-…&stage=stg-…` — what funding one stage takes for the
 * caller (Decision #197): its unfunded tickets at their prices, any still unpriced, and the wallet the
 * escrow is held from with its balance.
 *
 * `GET /api/finance/escrow/quote?project=prj-…&ticket=tkt-…` — what funding one ticket takes (Decision
 * #428): every stage it runs through at its own price, the one paid now, the prepaid refund window and
 * the paying wallet.
 *
 * Thin: Zod-validate the query (a stage or a ticket, never both) and delegate; the database applies the
 * payer rule, and `fund_stage` / `fund_ticket` / `begin_card_payment` re-check everything at the commit.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const url = new URL(ctx.req.url);
		const parsed = EscrowQuoteQuerySchema.safeParse({
			project: url.searchParams.get("project") ?? "",
			stage: url.searchParams.get("stage") ?? undefined,
			ticket: url.searchParams.get("ticket") ?? undefined,
		});
		if (!parsed.success) return invalidBody(parsed.error);
		const { project, stage, ticket } = parsed.data;
		if (ticket !== undefined) {
			return toPaymentsResponse(
				await StageFundingBackendService.quoteTicket({ project, ticket }, readActor(ctx)),
			);
		}
		return toPaymentsResponse(
			await StageFundingBackendService.quote({ project, stage: stage ?? "" }, readActor(ctx)),
		);
	},
});
