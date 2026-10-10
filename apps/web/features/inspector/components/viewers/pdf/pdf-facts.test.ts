import { assertEquals } from "@std/assert";
import { documentFacts, pageSizeLabel, parsePdfDate, readPdfInfo } from "./pdf-facts.ts";

Deno.test("parsePdfDate reads full, partial and offset dates", () => {
	assertEquals(parsePdfDate("D:20240315103000Z")?.toISOString(), "2024-03-15T10:30:00.000Z");
	assertEquals(parsePdfDate("D:20240315103000+02'00'")?.toISOString(), "2024-03-15T08:30:00.000Z");
	assertEquals(parsePdfDate("D:20240315103000-05'30")?.toISOString(), "2024-03-15T16:00:00.000Z");
	assertEquals(parsePdfDate("D:2024")?.toISOString(), "2024-01-01T00:00:00.000Z");
	assertEquals(parsePdfDate("20240315")?.toISOString(), "2024-03-15T00:00:00.000Z");
	assertEquals(parsePdfDate("D:20241315"), null);
	assertEquals(parsePdfDate("yesterday"), null);
});

Deno.test("readPdfInfo keeps trimmed strings and ignores everything else", () => {
	const info = readPdfInfo({
		Title: "  Annual   report ",
		Author: "",
		Subject: 42,
		Producer: "pdfTeX-1.40",
		PDFFormatVersion: "1.7",
		CreationDate: "D:20240101000000Z",
		ModDate: "not a date",
	});
	assertEquals(info.title, "Annual report");
	assertEquals(info.author, null);
	assertEquals(info.subject, null);
	assertEquals(info.producer, "pdfTeX-1.40");
	assertEquals(info.version, "1.7");
	assertEquals(info.created?.toISOString(), "2024-01-01T00:00:00.000Z");
	assertEquals(info.modified, null);
	assertEquals(readPdfInfo(null).title, null);
	assertEquals(readPdfInfo({ Title: "x".repeat(400) }).title?.length, 300);
});

Deno.test("pageSizeLabel names common papers either way up", () => {
	assertEquals(pageSizeLabel(595.28, 841.89), "A4 · 210 × 297 mm");
	assertEquals(pageSizeLabel(841.89, 595.28), "A4 landscape · 297 × 210 mm");
	assertEquals(pageSizeLabel(612, 792), "Letter · 8.5 × 11 in");
	assertEquals(pageSizeLabel(500, 500), "176 × 176 mm");
});

Deno.test("documentFacts orders the rows and skips unknowns and known page counts", () => {
	const info = readPdfInfo({ Title: "Plan", PDFFormatVersion: "1.4", Producer: "Skia" });
	const format = (d: Date) => d.toISOString().slice(0, 10);
	assertEquals(
		documentFacts({
			info,
			pageCount: 3,
			knownPageCount: null,
			firstPage: null,
			formatDate: format,
		}),
		[
			{ label: "Title", value: "Plan" },
			{ label: "Pages", value: "3" },
			{ label: "PDF version", value: "1.4" },
			{ label: "Produced by", value: "Skia" },
		],
	);
	const withSize = documentFacts({
		info: readPdfInfo({ CreationDate: "D:20240102" }),
		pageCount: 3,
		knownPageCount: 3,
		firstPage: { width: 612, height: 792 },
		formatDate: format,
	});
	assertEquals(withSize, [
		{ label: "Page size", value: "Letter · 8.5 × 11 in" },
		{ label: "Created", value: "2024-01-02" },
	]);
});
