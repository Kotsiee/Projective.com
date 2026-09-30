import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { pdfResponse } from "@features/payments/core/respond.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/finance/statements/[id]/pdf` — a statement of an account the caller can see, as a PDF.
 *
 * Thin: validate the id and delegate. The fat {@link WalletBackendService} reads the statement through
 * RLS (`View own statements`) and renders it; a stranger's statement is a 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		if (!UUID_RE.test(ctx.params.id)) {
			return Response.json({ ok: false, message: "That statement wasn't found." }, { status: 404 });
		}
		return pdfResponse(await WalletBackendService.documentPdf("statement", ctx.params.id, readActor(ctx)));
	},
});
