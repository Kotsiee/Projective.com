import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { BillingBackendService } from "@server/services/finance/BillingBackendService.ts";

/**
 * `POST /api/finance/invoices/[id]/pay` — pay a business invoice's amount due from the business wallet.
 * Thin: validate the id and delegate to {@link BillingBackendService.payInvoice}; `finance.pay_invoice`
 * checks `manage_billing`, an active and KYB-verified business, and the balance. Answers with the
 * refreshed Billing module projection — on a refusal too, when it can be read — in the workspace
 * envelope the Billing island reads, `details.reason` included (Decision #247).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.id);
		if (!id.success) {
			return Response.json({ ok: false, message: "That invoice wasn't found." }, { status: 404 });
		}
		return toWorkspaceResponse(
			await BillingBackendService.payInvoice(id.data, readActor(ctx)),
		);
	},
});
