import { assertEquals } from "@std/assert";
import { docxHead } from "./docx-head.ts";

const para = (inner: string, props = "") => `<w:p><w:pPr>${props}</w:pPr>${inner}</w:p>`;
const run = (text: string, props = "") =>
	`<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

Deno.test("headings take Word's sizes and weight; body text its own", () => {
	const body = docxHead(
		para(run("Report"), '<w:pStyle w:val="Heading1"/>') + para(run("Plain text")),
		72,
	);
	const [heading, plain] = body!.paragraphs;
	assertEquals([heading.runs[0].size, heading.runs[0].bold], [20, true]);
	assertEquals([plain.runs[0].size, plain.runs[0].bold], [11, false]);
});

Deno.test("a run's own size, weight, slant and colour are read", () => {
	const body = docxHead(
		para(run("x", '<w:b/><w:i/><w:sz w:val="48"/><w:color w:val="FF0000"/>')),
		0,
	);
	const [only] = body!.paragraphs[0].runs;
	assertEquals([only.size, only.bold, only.italic, only.color], [24, true, true, "#FF0000"]);
});

Deno.test("a toggle switched off stays off", () => {
	const body = docxHead(para(run("x", '<w:b w:val="0"/>')), 0);
	assertEquals(body!.paragraphs[0].runs[0].bold, false);
});

Deno.test("alignment, list items and escaped text survive", () => {
	const body = docxHead(
		para(run("Tom &amp; Jerry &#8212; &lt;x&gt;"), '<w:jc w:val="center"/><w:numPr></w:numPr>'),
		0,
	);
	const [paragraph] = body!.paragraphs;
	assertEquals(paragraph.align, "center");
	assertEquals(paragraph.bullet, "•");
	assertEquals(paragraph.runs[0].text, "Tom & Jerry — <x>");
});

Deno.test("a head cut off mid-paragraph keeps the paragraphs that closed", () => {
	const xml = para(run("kept")) + "<w:p><w:r><w:t>cut off he";
	const body = docxHead(xml, 0);
	assertEquals(body!.paragraphs.length, 1);
	assertEquals(body!.paragraphs[0].runs[0].text, "kept");
});

Deno.test("a document with no text gives nothing to draw", () => {
	assertEquals(docxHead(para(""), 0), null);
	assertEquals(docxHead("<w:document/>", 0), null);
});
