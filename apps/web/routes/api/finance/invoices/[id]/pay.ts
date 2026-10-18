import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { BillingBackendService } from "@server/services/finance/BillingBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/finance/invoices/[id]/pay` — pay a business invoice's amount due from the business wallet.
 * Thin: validate the id and delegate to {@link BillingBackendService.payInvoice}; `finance.pay_invoice`
 * checks `manage_billing`, an active and KYB-verified business, and the balance. Answers with the
 * refreshed Billing module projection — on a refusal too, when it can be read — in the workspace
 * envelope the Billing island reads, `details.reason` included (Decision #247).
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!UUID_RE.test(ctx.params.id)) {
			return Response.json({ ok: false, message: "That invoice wasn't found." }, { status: 404 });
		}
		return toWorkspaceResponse(
			await BillingBackendService.payInvoice(ctx.params.id, readActor(ctx)),
		);
	},
});
