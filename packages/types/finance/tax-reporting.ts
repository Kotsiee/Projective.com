import { z } from "zod";
import { currency, FinanceOwnerType, minorUnitsNonNeg, timestamp, uuid } from "./common.ts";

/**
 * finance seller tax reporting and tax documents (LEGAL LG6, Decision #527, ruling A: Stripe first).
 * Mirrors the 00001200 regions "Seller tax reporting" (`finance.read_seller_tax_report`, operator only)
 * and "Seller tax documents" (`finance.list_tax_documents`, `mark_tax_document`, `share_tax_document`,
 * the seller's own). What Stripe collects and files stays Stripe's; this is the per-seller dataset
 * Projective keeps for an operator to export, and the residence certificate a seller shows one client.
 * Whether and where Projective must report is counsel's (#527 (A)).
 */

// #region Seller tax report (operator)
/** The first and last calendar year the report door accepts (`finance.read_seller_tax_report`). */
export const TAX_REPORT_YEAR_MIN = 2000;
export const TAX_REPORT_YEAR_MAX = 9998;

/** `?year=` on the export route: a whole calendar year the door accepts. */
export const TaxReportYearSchema = z.coerce.number().int().min(TAX_REPORT_YEAR_MIN).max(TAX_REPORT_YEAR_MAX);

/**
 * One seller × currency × calendar quarter (UTC). `creditedMinor` is what the ledger credited them as
 * income, dated when it reached the wallet; `feesMinor` the platform fees attributed to it; `grossMinor`
 * their sum; `activities` the distinct escrows and orders it came from. `profileCountry` is what the
 * seller's own profile states (free text, unverified; a team holds none). The payout account is the
 * reference to the identity and tax number Stripe holds.
 */
export const SellerTaxReportRowSchema = z.object({
	sellerType: FinanceOwnerType,
	sellerId: uuid,
	currency,
	quarter: z.number().int().min(1).max(4),
	creditedMinor: minorUnitsNonNeg,
	feesMinor: minorUnitsNonNeg,
	grossMinor: minorUnitsNonNeg,
	activities: z.number().int().min(1),
	profileCountry: z.string().nullable(),
	payoutProvider: z.string().nullable(),
	payoutAccountId: z.string().nullable(),
});
export type SellerTaxReportRow = z.infer<typeof SellerTaxReportRowSchema>;

/** A calendar year's report, rows ordered by seller, currency, then quarter. */
export const SellerTaxReportSchema = z.object({
	year: z.number().int(),
	rows: z.array(SellerTaxReportRowSchema),
});
export type SellerTaxReport = z.infer<typeof SellerTaxReportSchema>;
// #endregion

// #region Tax documents (the seller's own)
/** The one kind a seller keeps today: a tax residence certificate. */
export const TaxDocumentKind = z.enum(["residence_certificate"]);
export type TaxDocumentKind = z.infer<typeof TaxDocumentKind>;

/** A project whose client a seller may show a tax document to, with that client. */
export const TaxDocumentTargetSchema = z.object({
	projectId: uuid,
	projectSlug: z.string(),
	projectTitle: z.string(),
	clientUserId: uuid,
	clientName: z.string(),
});
export type TaxDocumentTarget = z.infer<typeof TaxDocumentTargetSchema>;

/**
 * Who a document is shown to: one client, named through the project it was shared for. The project
 * fields are null when that project has since gone.
 */
export const TaxDocumentShareSchema = z.object({
	projectId: uuid.nullable(),
	projectSlug: z.string().nullable(),
	projectTitle: z.string().nullable(),
	clientUserId: uuid,
	clientName: z.string(),
});
export type TaxDocumentShare = z.infer<typeof TaxDocumentShareSchema>;

/** One of the seller's tax documents: a private file in their library, shown to one client or none. */
export const TaxDocumentSchema = z.object({
	fileId: uuid,
	kind: TaxDocumentKind,
	name: z.string(),
	mimeType: z.string(),
	sizeBytes: z.number().int().min(0),
	createdAt: timestamp,
	shared: TaxDocumentShareSchema.nullable(),
});
export type TaxDocument = z.infer<typeof TaxDocumentSchema>;

/** The Tax documents section's read: the seller's documents and the clients they may show one to. */
export const TaxDocumentsSchema = z.object({
	documents: z.array(TaxDocumentSchema),
	targets: z.array(TaxDocumentTargetSchema),
});
export type TaxDocuments = z.infer<typeof TaxDocumentsSchema>;

/** `POST /api/finance/tax-documents`: mark an uploaded file of the caller's as a certificate. */
export const MarkTaxDocumentInputSchema = z.object({ fileId: uuid });
export type MarkTaxDocumentInput = z.infer<typeof MarkTaxDocumentInputSchema>;

/** `POST /api/finance/tax-documents/[fileId]/share`: show it to this project's client, or to nobody. */
export const ShareTaxDocumentInputSchema = z.object({ projectId: uuid.nullable() });
export type ShareTaxDocumentInput = z.infer<typeof ShareTaxDocumentInputSchema>;
// #endregion
