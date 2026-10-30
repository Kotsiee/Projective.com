import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { pdfResponse } from "@features/payments/core/respond.ts";
import { fail } from "@server/services/ServiceResult.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/finance/invoices/[id]/pdf` — an invoice the caller is party to, as a PDF download.
 *
 * Thin: validate the id and delegate. The fat {@link WalletBackendService} reads the invoice and its
 * line items through RLS (`View invoices you are party to`) and renders it; a stranger's invoice is a
 * 404, exactly like one that does not exist. A refusal is JSON `{ code, message }` with its status
 * ({@link pdfResponse}), never a file.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.id);
		if (!id.success) {
			return pdfResponse(
				fail(404, { message: "That invoice wasn't found.", details: { code: "not_found" } }),
			);
		}
		return pdfResponse(await WalletBackendService.documentPdf("invoice", id.data, readActor(ctx)));
	},
});
