import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { pdfResponse } from "@features/payments/core/respond.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/finance/invoices/[id]/pdf` — an invoice the caller is party to, as a PDF download.
 *
 * Thin: validate the id and delegate. The fat {@link WalletBackendService} reads the invoice and its
 * line items through RLS (`View invoices you are party to`) and renders it; a stranger's invoice is a
 * 404, exactly like one that does not exist.
 */
export const handler = define.handlers({
	async GET(ctx) {
		if (!UUID_RE.test(ctx.params.id)) {
			return Response.json({ ok: false, message: "That invoice wasn't found." }, { status: 404 });
		}
		return pdfResponse(await WalletBackendService.documentPdf("invoice", ctx.params.id, readActor(ctx)));
	},
});
