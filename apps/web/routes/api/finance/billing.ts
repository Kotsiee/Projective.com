import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateBillingInputSchema } from "@projective/types/finance";
import { toFieldErrors, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { BillingBackendService } from "@server/services/finance/BillingBackendService.ts";

/**
 * `POST /api/finance/billing` — thin route for the business console's Billing module: Zod-validate the
 * settings patch (invoicing terms · auto-funding · balance floor) and delegate to the fat
 * {@link BillingBackendService.update}, which writes through doors that check `manage_billing`.
 * Answers with the refreshed module projection.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = UpdateBillingInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		return toPaymentsResponse(await BillingBackendService.update(parsed.data, readActor(ctx)));
	},
});
