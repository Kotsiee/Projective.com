/** The legal PDF: line breaking, the layout of a version, and the service's file + cache facts. */
import { assert, assertEquals, assertFalse, assertNotEquals } from "@std/assert";
import type { LegalDoc } from "@projective/types/content";
import {
	blockText,
	DRAFT_PDF_LINE,
	isPdfEncodable,
	legalPdfBlocks,
	measure,
	PDF_TEXT_WIDTH,
	pdfSafe,
	wrapText,
} from "./legal-pdf.ts";
import { LegalBackendService } from "./LegalBackendService.ts";

const DOC: LegalDoc = {
	id: "escrow-terms",
	slug: "escrow-terms",
	title: "Escrow Terms",
	summary: "How money for work is held and released.",
	updatedAt: "2026-10-17",
	version: "2.0",
	effectiveDate: "2026-10-17",
	reviewedAt: null,
	changeSummary: "Adds the pending window.",
	sections: [
		{
			id: "fees",
			heading: "The platform fee",
			tldr: "Projective keeps 5% of every release.",
			body: [
				{ type: "p", content: "The platform fee is 5% of each release, deducted from the payee." },
				{ type: "h3", text: "Exceptions" },
				{
					type: "list",
					ordered: true,
					marker: "lower-alpha",
					items: ["No fee on a refund.", "Fair Exit."],
				},
				{ type: "table", head: ["Tier", "Paid"], rows: [["25%", "A quarter"]], rowHeaders: true },
				{ type: "dl", items: [{ term: "Payee", definition: "Whoever is paid." }] },
			],
		},
		{
			id: "pending-window",
			heading: "The 7-day pending window",
			body: [{ type: "p", content: "Earned money waits 7 days." }],
		},
	],
};
const OPTS = { current: true, canonical: "https://projective.app/legal/escrow-terms" };

// #region Measure
Deno.test("wrapText: no line is wider than the page, and no word is lost", () => {
	const text = "Projective holds escrow on its own ledger and releases it only under these terms. "
		.repeat(12);
	const lines = wrapText(text, 10.5, PDF_TEXT_WIDTH);
	assert(lines.length > 3);
	for (const line of lines) assert(measure(line, 10.5) <= PDF_TEXT_WIDTH, line);
	assertEquals(lines.join(" "), text.trim());
});

Deno.test("wrapText: a word longer than the line is cut, never overflowing", () => {
	const lines = wrapText("x".repeat(400), 10, 100);
	assert(lines.length > 1);
	for (const line of lines) assert(measure(line, 10) <= 100);
	assertEquals(lines.join(""), "x".repeat(400));
	assertEquals(wrapText("", 10, 100), [""]);
});

Deno.test("isPdfEncodable: WinAnsi text yes, anything else no", () => {
	assert(isPdfEncodable("£10 · €5 — “quoted” ’s … 5%"));
	assertFalse(isPdfEncodable("≥ 18"));
	assertFalse(isPdfEncodable("→"));
	assert(isPdfEncodable(pdfSafe("Settings → Account, ≥ 18")));
	assertEquals(pdfSafe("Settings → Account"), "Settings -> Account");
});
// #endregion

// #region Layout
Deno.test("legalPdfBlocks: the draft mark heads and closes the file; version and dates are stated", () => {
	const text = blockText(legalPdfBlocks(DOC, OPTS));
	assertEquals(text[1], DRAFT_PDF_LINE, "the brand row carries the draft mark");
	assertEquals(text[text.length - 1], DRAFT_PDF_LINE);
	assert(text.some((line) => line.includes("Version 2.0 · Effective 17 October 2026")));
	assert(text.some((line) => line.startsWith("Draft — pending legal review.")));
});

Deno.test("legalPdfBlocks: clauses are numbered, summaries labelled, lists and tables flattened", () => {
	const text = blockText(legalPdfBlocks(DOC, OPTS));
	assert(text.includes("1. The platform fee"));
	assert(text.includes("2. The 7-day pending window"));
	assert(text.includes("1.1 Exceptions"));
	assert(text.includes("PLAIN-ENGLISH SUMMARY"));
	assert(text.includes("(a) No fee on a refund."));
	assert(text.includes("(b) Fair Exit."));
	assert(text.includes("Tier: 25%"));
	assert(text.includes("Paid: A quarter"));
	assert(text.includes("Payee"));
});

Deno.test("legalPdfBlocks: a reviewed version carries no draft mark; an old one points at the current", () => {
	const reviewed = blockText(legalPdfBlocks({ ...DOC, reviewedAt: "2026-10-20" }, OPTS));
	assertFalse(reviewed.includes(DRAFT_PDF_LINE));
	assert(reviewed.some((line) => line.includes("Reviewed 20 October 2026")));
	const old = blockText(legalPdfBlocks(DOC, { ...OPTS, current: false }));
	assert(old.some((line) => line.includes("not the version in effect today")));
});
// #endregion

// #region Service
Deno.test("LegalBackendService.documentPdf: a PDF file, a draft name, a stable content ETag", () => {
	const first = LegalBackendService.documentPdf(DOC, OPTS);
	assert(first.ok && first.data);
	assertEquals(first.status, 200);
	assertEquals(first.data.filename, "projective-escrow-terms-v2.0-draft.pdf");
	assert(first.data.draft);
	assertEquals(new TextDecoder().decode(first.data.bytes.slice(0, 8)), "%PDF-1.4");
	assert(new TextDecoder("latin1").decode(first.data.bytes).includes("%%EOF"));
	assert(/^"legal-escrow-terms-2\.0-[0-9a-f]{8}"$/.test(first.data.etag));

	const again = LegalBackendService.documentPdf(DOC, OPTS);
	assertEquals(again.data?.etag, first.data.etag);
	assert(again.data?.bytes === first.data.bytes, "served from the in-process cache");

	const edited = LegalBackendService.documentPdf({ ...DOC, summary: "Changed." }, OPTS);
	assertNotEquals(edited.data?.etag, first.data.etag);
	const reviewed = LegalBackendService.documentPdf({ ...DOC, reviewedAt: "2026-10-20" }, OPTS);
	assertEquals(reviewed.data?.filename, "projective-escrow-terms-v2.0.pdf");
	assertFalse(reviewed.data?.draft);
});
// #endregion
