import { assertEquals } from "@std/assert";
import {
	clampDocxZoom,
	DOCX_ZOOM_MAX,
	DOCX_ZOOM_MIN,
	docxFacts,
	docxFeatures,
	docxProperties,
	docxRenderRoots,
	fitDocxZoom,
	formatDocxZoom,
	safeDocxHref,
	scrubDocxTree,
	stepDocxZoom,
} from "./docx-model.ts";

Deno.test("zoom ladder steps, clamps and formats", () => {
	assertEquals(stepDocxZoom(1, 1), 1.1);
	assertEquals(stepDocxZoom(1, -1), 0.9);
	assertEquals(stepDocxZoom(1.17, 1), 1.25);
	assertEquals(stepDocxZoom(1.17, -1), 1.1);
	assertEquals(stepDocxZoom(DOCX_ZOOM_MAX, 1), DOCX_ZOOM_MAX);
	assertEquals(stepDocxZoom(DOCX_ZOOM_MIN, -1), DOCX_ZOOM_MIN);
	assertEquals(clampDocxZoom(Number.NaN), 1);
	assertEquals(clampDocxZoom(-2), 1);
	assertEquals(clampDocxZoom(9), DOCX_ZOOM_MAX);
	assertEquals(formatDocxZoom(0.6666), "67%");
});

Deno.test("fitDocxZoom fits the widest page; auto never enlarges", () => {
	assertEquals(fitDocxZoom(408, 816, "fit"), 0.5);
	assertEquals(fitDocxZoom(1632, 816, "fit"), 2);
	assertEquals(fitDocxZoom(1632, 816, "auto"), 1);
	assertEquals(fitDocxZoom(408, 816, "auto"), 0.5);
	assertEquals(fitDocxZoom(0, 816, "fit"), 1);
	assertEquals(fitDocxZoom(500, 0, "fit"), 1);
	assertEquals(fitDocxZoom(10, 816, "fit"), DOCX_ZOOM_MIN);
});

Deno.test("scrubDocxTree rewrites non-hex symbol characters across every rendered part", () => {
	const evil = { type: "symbol", char: "41;<img src=x onerror=alert(1)>", font: "Symbol" };
	const fine = { type: "symbol", char: "F0B7", font: "Symbol" };
	const huge = { type: "symbol", char: "FFFFFF" };
	const footer = { type: "footer", children: [{ type: "paragraph", children: [huge] }] };
	const note = { type: "footnote", children: [{ type: "symbol", char: 65 }] };
	const body = { type: "document", children: [{ type: "paragraph", children: [evil, fine] }] };
	const doc = {
		documentPart: { body },
		parts: [{ rootElement: footer }, { notes: [note] }, { props: {} }],
	};
	const roots = docxRenderRoots(doc);
	assertEquals(roots.length, 3);
	assertEquals(scrubDocxTree(roots), 3);
	assertEquals(evil.char, "fffd");
	assertEquals(fine.char, "F0B7");
	assertEquals(huge.char, "fffd");
	assertEquals(scrubDocxTree(roots), 0);
});

Deno.test("scrubDocxTree tolerates cycles and foreign values", () => {
	const loop: Record<string, unknown> = { type: "paragraph", children: [] };
	(loop.children as unknown[]).push(loop, null, 3, "text");
	assertEquals(scrubDocxTree([loop, undefined]), 0);
	assertEquals(docxRenderRoots(null), []);
	assertEquals(docxRenderRoots({ parts: "nope" }), []);
});

Deno.test("docxFeatures detects header/footer content, note references and tracked changes", () => {
	const plain = {
		documentPart: { body: { type: "document", children: [{ type: "paragraph", children: [] }] } },
		parts: [{ rootElement: { type: "header", children: [] } }, { notes: [{ type: "footnote" }] }],
	};
	assertEquals(docxFeatures(plain), { headersFooters: false, notes: false, changes: false });
	const rich = {
		documentPart: {
			body: {
				type: "document",
				children: [{
					type: "paragraph",
					children: [{ type: "footnoteReference" }, { type: "inserted", children: [] }],
				}],
			},
		},
		parts: [{ rootElement: { type: "footer", children: [{ type: "paragraph" }] } }],
	};
	assertEquals(docxFeatures(rich), { headersFooters: true, notes: true, changes: true });
	assertEquals(docxFeatures(undefined), { headersFooters: false, notes: false, changes: false });
});

Deno.test("safeDocxHref keeps anchors and web links, drops script and file targets", () => {
	assertEquals(safeDocxHref("#_Toc123"), { href: "#_Toc123", external: false });
	assertEquals(safeDocxHref(" https://example.com/a b "), {
		href: "https://example.com/a%20b",
		external: true,
	});
	assertEquals(safeDocxHref("mailto:hi@example.com"), {
		href: "mailto:hi@example.com",
		external: true,
	});
	assertEquals(safeDocxHref("javascript:alert(1)"), null);
	assertEquals(safeDocxHref("JaVaScRiPt:alert(1)"), null);
	assertEquals(safeDocxHref("data:text/html,<script>1</script>"), null);
	assertEquals(safeDocxHref("file:///C:/secret.docx"), null);
	assertEquals(safeDocxHref("other.docx"), null);
	assertEquals(safeDocxHref("#"), null);
	assertEquals(safeDocxHref(null), null);
});

Deno.test("docxProperties and docxFacts read core and extended properties", () => {
	const props = docxProperties({
		corePropsPart: { props: { title: " Plan ", creator: "Chloe", description: "x" } },
		extendedPropsPart: { props: { pages: 12, words: 3456, application: "Microsoft Office Word" } },
	});
	assertEquals(props, {
		title: "Plan",
		author: "Chloe",
		application: "Microsoft Office Word",
		pages: 12,
		words: 3456,
	});
	assertEquals(docxFacts(props, null), [
		{ label: "Title", value: "Plan" },
		{ label: "Author", value: "Chloe" },
		{ label: "Pages", value: "12" },
		{ label: "Words", value: "3,456" },
		{ label: "Created with", value: "Microsoft Office Word" },
	]);
	assertEquals(docxFacts(props, 12).some((f) => f.label === "Pages"), false);
	assertEquals(docxProperties({ extendedPropsPart: { props: { pages: Number.NaN } } }), {
		title: null,
		author: null,
		application: null,
		pages: null,
		words: null,
	});
});
