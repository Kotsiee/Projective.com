import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ShareTaxDocumentInputSchema, uuid } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { TaxReportingService } from "@server/services/finance/TaxReportingService.ts";

/**
 * `POST /api/finance/tax-documents/[fileId]/share` `{ projectId | null }` — show the seller's
 * certificate to that project's client and nobody else, replacing any earlier share, or with `null`
 * make it private again (`finance.share_tax_document`; 404 not their document, 400 a project they
 * cannot show it to).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.fileId);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown document." }, { status: 404 });
		}
		const parsed = ShareTaxDocumentInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await TaxReportingService.shareTaxDocument(readActor(ctx), id.data, parsed.data.projectId),
		);
	},
});
