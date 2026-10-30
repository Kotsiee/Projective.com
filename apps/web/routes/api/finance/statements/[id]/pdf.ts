import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { pdfResponse } from "@features/payments/core/respond.ts";
import { fail } from "@server/services/ServiceResult.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/finance/statements/[id]/pdf` — a statement of an account the caller can see, as a PDF.
 *
 * Thin: validate the id and delegate. The fat {@link WalletBackendService} reads the statement through
 * RLS (`View own statements`) and renders it; a stranger's statement is a 404. A refusal is JSON
 * `{ code, message }` with its status ({@link pdfResponse}), never a file.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.id);
		if (!id.success) {
			return pdfResponse(
				fail(404, { message: "That statement wasn't found.", details: { code: "not_found" } }),
			);
		}
		return pdfResponse(
			await WalletBackendService.documentPdf("statement", id.data, readActor(ctx)),
		);
	},
});
