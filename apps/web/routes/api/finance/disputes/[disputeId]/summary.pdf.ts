import { define } from "@web/utils/state.ts";
import { uuid } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { pdfResponse } from "@features/payments/core/respond.ts";
import { fail } from "@server/services/ServiceResult.ts";
import { DisputeBackendService } from "@server/services/finance/DisputeBackendService.ts";

/**
 * `GET /api/finance/disputes/[disputeId]/summary.pdf` — a case's summary as a PDF download (PROJECTS
 * EX3): the case, its timeline, statements, offers, ruling and the Evidence Vault's hash. Its parties
 * and operators only; 404 for anyone else, exactly as the case read (`finance.get_dispute`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = uuid.safeParse(ctx.params.disputeId);
		if (!id.success) {
			return pdfResponse(
				fail(404, { message: "Unknown dispute.", details: { code: "not_found" } }),
			);
		}
		return pdfResponse(await DisputeBackendService.summaryPdf(id.data, readActor(ctx)));
	},
});
