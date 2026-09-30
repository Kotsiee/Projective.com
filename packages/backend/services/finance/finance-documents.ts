import { DEFAULT_LOCALE, formatMoney } from "@projective/types/finance";
import { type PdfBlock, renderPdf } from "../../core/pdf.ts";
import { getUserClient } from "../../core/supabase.ts";

/**
 * finance-documents — the PDF renderings of an invoice and a statement, read as the signed-in caller.
 *
 * Both are read through RLS (`View invoices you are party to`, `View own statements`), so a document
 * the caller may not see simply does not exist for them (`null` → 404). Every figure is the stored
 * amount in the currency it was stored in — a financial document reprints what was billed, never a
 * conversion — formatted by the SSOT's one `formatMoney`.
 *
 * The file is rendered on request and streamed, never written to storage: the `pdf_file_id` columns
 * stay for a future issued-and-archived copy (Decision #126 flags it), and a rendering nobody asked for
 * is not worth a storage object that must then be access-controlled.
 */

type Row = Record<string, unknown>;

function money(minor: unknown, currency: string): string {
	const n = typeof minor === "number" ? minor : Number(minor ?? 0);
	return formatMoney(Number.isFinite(n) ? n : 0, currency.toUpperCase(), DEFAULT_LOCALE);
}

function date(value: unknown): string {
	if (typeof value !== "string" && !(value instanceof Date)) return "—";
	const ms = Date.parse(String(value));
	return Number.isFinite(ms)
		? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
		: "—";
}

function short(id: unknown): string {
	return String(id ?? "").slice(0, 8).toUpperCase();
}

/** What a rendered document is: its download name and its bytes. */
export interface RenderedDocument {
	filename: string;
	bytes: Uint8Array<ArrayBuffer>;
}

const INVOICE_STATUS: Record<string, string> = {
	draft: "Draft",
	issued: "Issued",
	paid: "Paid",
	overdue: "Overdue",
	void: "Void",
};

/** Render one invoice the caller may read, or `null`. */
export async function renderInvoicePdf(accessToken: string, invoiceId: string): Promise<RenderedDocument | null> {
	const db = getUserClient(accessToken).schema("finance");
	const { data: invoice, error } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
	if (error) throw new Error(`finance.invoices read failed: ${error.message}`);
	if (!invoice) return null;
	const inv = invoice as Row;
	const { data: lines, error: linesError } = await db.from("invoice_line_items")
		.select("description, amount_cents, currency, ref_type")
		.eq("invoice_id", invoiceId);
	if (linesError) throw new Error(`finance.invoice_line_items read failed: ${linesError.message}`);

	const currency = String(inv.currency ?? "USD");
	const blocks: PdfBlock[] = [
		{ kind: "row", left: { text: "Projective", size: 11, bold: true }, right: { text: "INVOICE", size: 11, bold: true } },
		{ kind: "space", points: 10 },
		{ kind: "row", left: { text: `Invoice ${short(inv.id)}`, size: 18, bold: true } },
		{
			kind: "row",
			left: {
				text: inv.invoice_type === "consolidated_monthly"
					? `Consolidated monthly · ${date(inv.billing_period_start)} – ${date(inv.billing_period_end)}`
					: "Per-stage invoice",
				size: 10,
			},
			right: { text: INVOICE_STATUS[String(inv.status)] ?? String(inv.status), size: 10, bold: true },
		},
		{ kind: "space", points: 8 },
		{ kind: "row", left: { text: "Invoice date", size: 9 }, right: { text: date(inv.created_at), size: 9 } },
		{ kind: "row", left: { text: "Due date", size: 9 }, right: { text: date(inv.due_date), size: 9 } },
		...(inv.paid_at
			? [{ kind: "row", left: { text: "Paid on", size: 9 }, right: { text: date(inv.paid_at), size: 9 } } as PdfBlock]
			: []),
		{ kind: "row", left: { text: "Currency", size: 9 }, right: { text: currency.toUpperCase(), size: 9 } },
		{ kind: "space", points: 12 },
		{ kind: "row", left: { text: "Description", size: 9, bold: true }, right: { text: "Amount", size: 9, bold: true } },
		{ kind: "rule" },
	];
	for (const line of (lines ?? []) as Row[]) {
		blocks.push({
			kind: "row",
			left: { text: String(line.description ?? "Line").slice(0, 90), size: 10 },
			right: { text: money(line.amount_cents, String(line.currency ?? currency)), size: 10 },
		});
	}
	if ((lines ?? []).length === 0) {
		blocks.push({ kind: "row", left: { text: "Services", size: 10 }, right: { text: money(inv.amount_cents, currency), size: 10 } });
	}
	blocks.push(
		{ kind: "rule" },
		{ kind: "row", left: { text: "Subtotal", size: 10 }, right: { text: money(inv.subtotal_cents, currency), size: 10 } },
		{ kind: "row", left: { text: "Platform fee", size: 10 }, right: { text: money(inv.platform_fee_cents, currency), size: 10 } },
		{ kind: "row", left: { text: "Tax", size: 10 }, right: { text: money(inv.tax_cents, currency), size: 10 } },
		{ kind: "space", points: 4 },
		{ kind: "row", left: { text: "Total", size: 13, bold: true }, right: { text: money(inv.total_cents, currency), size: 13, bold: true } },
		{ kind: "space", points: 24 },
		{ kind: "row", left: { text: `Reference ${String(inv.id)}`, size: 8 } },
		{ kind: "row", left: { text: "Card processing fees are passed through at cost and are not part of the platform fee.", size: 8 } },
	);
	return {
		filename: `projective-invoice-${short(inv.id).toLowerCase()}.pdf`,
		bytes: renderPdf({ title: `Invoice ${short(inv.id)}`, blocks }),
	};
}

/** Render one statement the caller may read, or `null`. */
export async function renderStatementPdf(accessToken: string, statementId: string): Promise<RenderedDocument | null> {
	const { data, error } = await getUserClient(accessToken).schema("finance").from("statements")
		.select("*").eq("id", statementId).maybeSingle();
	if (error) throw new Error(`finance.statements read failed: ${error.message}`);
	if (!data) return null;
	const st = data as Row;
	const currency = String(st.currency ?? "USD");
	const blocks: PdfBlock[] = [
		{ kind: "row", left: { text: "Projective", size: 11, bold: true }, right: { text: "STATEMENT", size: 11, bold: true } },
		{ kind: "space", points: 10 },
		{ kind: "row", left: { text: `${date(st.period_start)} – ${date(st.period_end)}`, size: 18, bold: true } },
		{ kind: "row", left: { text: `Statement ${short(st.id)} · ${currency.toUpperCase()}`, size: 10 } },
		{ kind: "space", points: 14 },
		{ kind: "row", left: { text: "Opening balance", size: 10 }, right: { text: money(st.opening_balance_cents, currency), size: 10 } },
		{ kind: "rule" },
		{ kind: "row", left: { text: "Money in", size: 10 }, right: { text: money(st.total_in_cents, currency), size: 10 } },
		{ kind: "row", left: { text: "Money out", size: 10 }, right: { text: `-${money(st.total_out_cents, currency)}`, size: 10 } },
		{ kind: "row", left: { text: "Fees", size: 10 }, right: { text: `-${money(st.total_fees_cents, currency)}`, size: 10 } },
		{ kind: "rule" },
		{ kind: "row", left: { text: "Closing balance", size: 13, bold: true }, right: { text: money(st.closing_balance_cents, currency), size: 13, bold: true } },
		{ kind: "space", points: 24 },
		{ kind: "row", left: { text: `Issued ${date(st.issued_at ?? st.created_at)} · Reference ${String(st.id)}`, size: 8 } },
	];
	return {
		filename: `projective-statement-${String(st.period_start ?? "").slice(0, 7) || short(st.id).toLowerCase()}.pdf`,
		bytes: renderPdf({ title: `Statement ${short(st.id)}`, blocks }),
	};
}
