import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateBillingInputSchema } from "@projective/types/finance";
import { invalidPayload, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { BillingBackendService } from "@server/services/finance/BillingBackendService.ts";

/**
 * `POST /api/finance/billing` — thin route for the business console's Billing module: Zod-validate the
 * settings patch (invoicing terms · auto-funding · balance floor) and delegate to the fat
 * {@link BillingBackendService.update}, which writes through doors that check `manage_billing`.
 * Answers with the refreshed module projection, in the workspace envelope the Billing island reads
 * (`WorkspaceService`) — `details.reason` included, so a refusal is worded from the business refusal
 * map (Decision #247).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = UpdateBillingInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await BillingBackendService.update(parsed.data, readActor(ctx)));
	},
});
