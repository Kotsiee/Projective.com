import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { MarkTaxDocumentInputSchema } from "@projective/types/finance";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { TaxReportingService } from "@server/services/finance/TaxReportingService.ts";

/**
 * `/api/finance/tax-documents` — the seller's tax documents (LEGAL LG6, Decision #527).
 * `GET`: their residence certificates and the clients they may show one to (`finance.list_tax_documents`).
 * `POST { fileId }`: mark a file they uploaded as a certificate, private and shown to nobody
 * (`finance.mark_tax_document`; 404 not theirs, 400 still uploading).
 */
export const handler = define.handlers({
	async GET(ctx) {
		return toPaymentsResponse(await TaxReportingService.listTaxDocuments(readActor(ctx)));
	},
	async POST(ctx) {
		const parsed = MarkTaxDocumentInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await TaxReportingService.markTaxDocument(readActor(ctx), parsed.data.fileId),
		);
	},
});
