import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import {
	FinanceOwnerType,
	type SellerTaxReport,
	type SellerTaxReportRow,
	TaxDocumentKind,
	type TaxDocument,
	type TaxDocuments,
	type TaxDocumentShare,
	type TaxDocumentTarget,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { csvText } from "./live-wallet.ts";

/**
 * TaxReportingService — seller tax reporting and tax documents (LEGAL LG6, Decision #527, ruling A:
 * Stripe first). Two operator reads and three seller doors, each a 00001200 definer that is its own
 * gate:
 * - `finance.read_seller_tax_report(year)`: per seller, currency and quarter, what the ledger credited
 *   them, the fees attributed and the activities paid; refuses anyone but an operator (42501 → 403,
 *   which the export route answers with a 404, as `/admin/ledger` does, Decision #212).
 * - `finance.list_tax_documents()`, `mark_tax_document(file)`, `share_tax_document(file, project)`: the
 *   seller's residence certificate, private, shown to one project's client or to nobody.
 * Filing is a person's job and Stripe's forms stay in Stripe; nothing here files, decides or moves money.
 */

// #region Raw rows (the SQL jsonb, as written by the functions)
interface RawReportRow {
	seller_type: string;
	seller_id: string;
	currency: string;
	quarter: number;
	credited_minor: number;
	fees_minor: number;
	gross_minor: number;
	activities: number;
	profile_country: string | null;
	payout_provider: string | null;
	payout_account_id: string | null;
}

/** `finance.read_seller_tax_report(year)`'s answer. */
export interface RawSellerTaxReport {
	year: number;
	rows: RawReportRow[] | null;
}

interface RawShare {
	project_id: string | null;
	project_slug: string | null;
	project_title: string | null;
	client_user_id: string;
	client_name: string | null;
}

interface RawDocument {
	file_id: string;
	kind: string;
	name: string;
	mime_type: string;
	size_bytes: number;
	created_at: string;
	shared: RawShare | null;
}

interface RawTarget {
	project_id: string;
	project_slug: string;
	project_title: string;
	client_user_id: string;
	client_name: string | null;
}

/** `finance.list_tax_documents()`'s answer. */
export interface RawTaxDocuments {
	documents: RawDocument[] | null;
	targets: RawTarget[] | null;
}
// #endregion

// #region Mapping
function toReportRow(raw: RawReportRow): SellerTaxReportRow | null {
	const sellerType = FinanceOwnerType.safeParse(raw.seller_type);
	if (!sellerType.success) return null;
	return {
		sellerType: sellerType.data,
		sellerId: raw.seller_id,
		currency: raw.currency,
		quarter: raw.quarter,
		creditedMinor: raw.credited_minor,
		feesMinor: raw.fees_minor,
		grossMinor: raw.gross_minor,
		activities: raw.activities,
		profileCountry: raw.profile_country,
		payoutProvider: raw.payout_provider,
		payoutAccountId: raw.payout_account_id,
	};
}

/** The jsonb onto {@link SellerTaxReport}, order kept. An owner kind this build does not know is dropped. */
export function toSellerTaxReport(raw: RawSellerTaxReport | null, year: number): SellerTaxReport {
	return {
		year: raw?.year ?? year,
		rows: (raw?.rows ?? []).map(toReportRow).filter((row): row is SellerTaxReportRow => row !== null),
	};
}

/** The columns of the export, in order: one line per seller × currency × quarter. */
export const SELLER_TAX_REPORT_COLUMNS = [
	"year",
	"quarter",
	"seller_type",
	"seller_id",
	"currency",
	"credited_minor",
	"fees_minor",
	"gross_minor",
	"activities",
	"profile_country",
	"payout_provider",
	"payout_account_id",
] as const;

/**
 * The report as CSV. Amounts stay integer minor units of their own currency, never converted, so a
 * filing can be prepared from them in whatever unit its schema asks for. Text cells go through
 * {@link csvText}: quoted when they must be, and never a formula.
 */
export function sellerTaxReportCsv(report: SellerTaxReport): string {
	const lines = report.rows.map((r) =>
		[
			String(report.year),
			String(r.quarter),
			r.sellerType,
			r.sellerId,
			csvText(r.currency),
			String(r.creditedMinor),
			String(r.feesMinor),
			String(r.grossMinor),
			String(r.activities),
			csvText(r.profileCountry),
			csvText(r.payoutProvider),
			csvText(r.payoutAccountId),
		].join(",")
	);
	return [SELLER_TAX_REPORT_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

function toShare(raw: RawShare): TaxDocumentShare {
	return {
		projectId: raw.project_id,
		projectSlug: raw.project_slug,
		projectTitle: raw.project_title,
		clientUserId: raw.client_user_id,
		clientName: raw.client_name ?? "",
	};
}

/** One document, or null for a kind this build does not know. */
export function toTaxDocument(raw: RawDocument | null): TaxDocument | null {
	if (!raw) return null;
	const kind = TaxDocumentKind.safeParse(raw.kind);
	if (!kind.success) return null;
	return {
		fileId: raw.file_id,
		kind: kind.data,
		name: raw.name,
		mimeType: raw.mime_type,
		sizeBytes: raw.size_bytes,
		createdAt: raw.created_at,
		shared: raw.shared ? toShare(raw.shared) : null,
	};
}

function toTarget(raw: RawTarget): TaxDocumentTarget {
	return {
		projectId: raw.project_id,
		projectSlug: raw.project_slug,
		projectTitle: raw.project_title,
		clientUserId: raw.client_user_id,
		clientName: raw.client_name ?? "",
	};
}

/** The section's read onto {@link TaxDocuments}. Pure; pinned by `TaxReportingService.test.ts`. */
export function toTaxDocuments(raw: RawTaxDocuments | null): TaxDocuments {
	return {
		documents: (raw?.documents ?? []).map(toTaxDocument).filter((d): d is TaxDocument => d !== null),
		targets: (raw?.targets ?? []).map(toTarget),
	};
}
// #endregion

// #region The calls
/** A definer's refusal as the route's status: 403 not allowed, 404 not found, 400 refused input. */
function refusal<T>(error: { code?: string; message: string }): ServiceResult<T> {
	if (error.code === "42501") return fail(403, { message: error.message });
	if (error.code === "PF404") return fail(404, { message: error.message });
	if (error.code === "22023") return fail(400, { message: error.message });
	return fail(502, { message: "That couldn't be done just now. Please try again." });
}

/** One finance rpc as the signed-in caller, mapped through `map`. Never throws into the route. */
async function callFinance<T>(
	actor: ReadActor,
	fn: string,
	args: Record<string, unknown> | undefined,
	map: (data: unknown) => T,
	logScope: string,
): Promise<ServiceResult<T>> {
	if (!isFinanceBackendLive()) return fail(503, { message: "This needs the live database." });
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	try {
		const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(fn, args);
		if (error) return refusal<T>(error);
		return ok(map(data));
	} catch (error) {
		console.error(`[tax:${logScope}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't reach the ledger just now. Try again in a moment." });
	}
}

/** The seller tax-reporting reads and the tax-document doors. */
export const TaxReportingService = {
	/** An operator's report for one calendar year. 403 for anyone else, 400 for a year the door refuses. */
	sellerTaxReport(actor: ReadActor, year: number | null): Promise<ServiceResult<SellerTaxReport>> {
		return callFinance(
			actor,
			"read_seller_tax_report",
			{ p_year: year },
			(data) => toSellerTaxReport(data as RawSellerTaxReport | null, year ?? 0),
			"report",
		);
	},
	/** The caller's tax documents and the clients they may show one to. */
	listTaxDocuments(actor: ReadActor): Promise<ServiceResult<TaxDocuments>> {
		return callFinance(
			actor,
			"list_tax_documents",
			undefined,
			(data) => toTaxDocuments(data as RawTaxDocuments | null),
			"list",
		);
	},
	/** Mark one of the caller's uploaded files as a residence certificate: private, shown to nobody. */
	markTaxDocument(actor: ReadActor, fileId: string): Promise<ServiceResult<TaxDocument | null>> {
		return callFinance(
			actor,
			"mark_tax_document",
			{ p_file_id: fileId },
			(data) => toTaxDocument(data as RawDocument | null),
			"mark",
		);
	},
	/** Show the caller's document to one project's client, or to nobody (`projectId` null). */
	shareTaxDocument(
		actor: ReadActor,
		fileId: string,
		projectId: string | null,
	): Promise<ServiceResult<TaxDocument | null>> {
		return callFinance(
			actor,
			"share_tax_document",
			{ p_file_id: fileId, p_project_id: projectId },
			(data) => toTaxDocument(data as RawDocument | null),
			"share",
		);
	},
};
// #endregion
