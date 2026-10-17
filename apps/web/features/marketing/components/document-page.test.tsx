/**
 * The public document path end to end, as the server renders it: the `<head>` tags a page's meta
 * stands for, the structured-data node, and the document composite.
 *
 * None of this shows on the page — a missing canonical, a JSON-LD body that breaks out of its
 * `<script>`, a meta date a machine cannot read — so the rendered strings are pinned here. The
 * composite is rendered through `DocumentPageView` with the static islands, exactly as a consumer's
 * page test would (the island-bound `DocumentPage` imports CSS and cannot load under `deno test`).
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { type Doc, readingMinutes, type TocEntry } from "@projective/types/content";
import { SAMPLE_DOC } from "@projective/types/content/fixtures";
import { jsonLdGraph, organizationJsonLd, pageMeta } from "../core/seo.ts";
import { PageMetaTags } from "./PageMetaTags.tsx";
import { JsonLd } from "./JsonLd.tsx";
import { defaultDocMeta, DocumentPageView, STATIC_DOCUMENT_ISLANDS } from "./DocumentPageView.tsx";

const ORIGIN = "https://projective.app";

/** Count of `needle` in `hay`. */
function count(hay: string, needle: string): number {
	return hay.split(needle).length - 1;
}

/**
 * Markup with one spelling per tag: the app's precompiled JSX writes void elements as `<link …>`
 * (no self-closing slash) and may leave a double space after a tag name.
 */
function head(html: string): string {
	return html.replace(/<(\w+)\s+/g, "<$1 ").replace(/\s*\/>/g, ">");
}

// #region Head
Deno.test("PageMetaTags: canonical, alternates, robots, the Open Graph block and the card", () => {
	const html = head(renderToString(
		<PageMetaTags
			meta={pageMeta({
				title: "Changelog",
				description: "What shipped.",
				path: "/changelog/",
				origin: ORIGIN,
				noindex: true,
				ogType: "article",
				ogImage: SAMPLE_DOC.cover,
				modifiedAt: "2026-10-17",
				alternates: [{ type: "application/rss+xml", href: "/changelog/rss.xml", title: "Feed" }],
			})}
		/>,
	));
	assertEquals(count(html, 'rel="canonical"'), 1);
	assertMatch(html, /<link rel="canonical" href="https:\/\/projective\.app\/changelog">/);
	assertMatch(
		html,
		/<link rel="alternate" type="application\/rss\+xml" href="https:\/\/projective\.app\/changelog\/rss\.xml" title="Feed">/,
	);
	assertMatch(html, /<meta name="robots" content="noindex, follow">/);
	for (
		const [property, content] of [
			["og:type", "article"],
			["og:site_name", "Projective"],
			["og:title", "Changelog"],
			["og:description", "What shipped."],
			["og:url", "https://projective.app/changelog"],
			["og:image", "https://projective.app/test_images/banner_1.jpg"],
			["og:image:alt", SAMPLE_DOC.cover.alt],
			["og:image:width", "643"],
			["og:image:height", "360"],
			["article:modified_time", "2026-10-17"],
		]
	) {
		assert(html.includes(`<meta property="${property}" content="${content}">`), property);
	}
	assertMatch(html, /<meta name="twitter:card" content="summary_large_image">/);
});

Deno.test("PageMetaTags: no alternates, no image — no alternate link, a summary card", () => {
	const html = head(renderToString(
		<PageMetaTags
			meta={pageMeta({ title: "Help", description: "d", path: "/help", origin: ORIGIN })}
		/>,
	));
	assertFalse(html.includes('rel="alternate"'));
	assertFalse(html.includes("og:image"));
	assertMatch(html, /<meta name="robots" content="index, follow">/);
	assertMatch(html, /<meta name="twitter:card" content="summary">/);
});

Deno.test("JsonLd: one script node with its id, a script-safe body, and the hydration anchor", () => {
	const graph = jsonLdGraph({
		...organizationJsonLd(ORIGIN),
		description: "</script><script>alert(1)</script>",
	});
	const html = renderToString(<JsonLd graph={graph} />);
	assertEquals(count(html, "<script"), 1);
	assertMatch(html, /^<script type="application\/ld\+json" id="page-jsonld">\{"@context"/);
	assertFalse(html.includes("</script><script>"), "the body cannot close its own element");
	const body = html.slice(html.indexOf(">") + 1, html.indexOf("</script>"));
	assertEquals(JSON.parse(body), graph, "the escapes parse back to the same graph");
	assertMatch(html, /<span hidden aria-hidden="true" data-schema-anchor><\/span>$/);
	assertMatch(renderToString(<JsonLd graph={graph} id="help-jsonld" />), /id="help-jsonld"/);
});
// #endregion

// #region Document composite
Deno.test("defaultDocMeta: a machine-readable date, the version, the reading time", () => {
	const html = renderToString(<>{defaultDocMeta(SAMPLE_DOC)}</>);
	assertEquals(
		html,
		`Updated <time datetime="2026-10-17">17 October 2026</time>Version 1.0${
			readingMinutes(SAMPLE_DOC)
		} min read`,
	);
});

Deno.test("DocumentPageView: header, a TOC for a multi-section doc, the body, no <main>", () => {
	const html = renderToString(
		<DocumentPageView doc={SAMPLE_DOC} eyebrow="Help" islands={STATIC_DOCUMENT_ISLANDS} />,
	);
	assertMatch(
		html,
		/<h1 id="doc-title" class="ui-doc-header__title">How stage payments work<\/h1>/,
	);
	assertMatch(html, /<time datetime="2026-10-17">17 October 2026<\/time>/);
	assertMatch(html, /<nav id="doc-toc" class="ui-toc" aria-label="On this page">/);
	assertMatch(html, /<span class="ui-doc-section__tldr-label">In short<\/span>/);
	assertFalse(html.includes("<main"));
	assertFalse(html.includes("ui-reading-progress"), "the static islands render no progress bar");
});

Deno.test("DocumentPageView: labels, a custom TOC tree and the variant hooks are forwarded", () => {
	const html = renderToString(
		<DocumentPageView
			doc={SAMPLE_DOC}
			numbered
			tocLabel="Legal documents"
			tldrLabel="Plain-English summary"
			tocEntries={(derived): TocEntry[] => [
				{ id: "doc-terms-link", text: "Terms", level: 2, href: "/legal/terms", children: [] },
				{
					id: "doc-sample-link",
					text: SAMPLE_DOC.title,
					level: 2,
					href: "/legal/sample",
					current: true,
					children: derived,
				},
			]}
			class="ui-doc--clauses"
			bodyClass="legal-body"
			islands={STATIC_DOCUMENT_ISLANDS}
		/>,
	);
	assertMatch(html, /^<div class="ui-doc ui-doc--clauses">/);
	assertMatch(html, /<nav id="doc-toc" class="ui-toc" aria-label="Legal documents">/);
	assertMatch(html, /<a class="ui-toc__link" href="\/legal\/sample" aria-current="page">/);
	assertMatch(html, /<a class="ui-toc__link" href="#fees"><span class="ui-toc__num">2<\/span>/);
	assertMatch(html, /<div class="ui-prose ui-doc-body ui-doc-body--numbered legal-body">/);
	assertMatch(html, /<span class="ui-doc-section__tldr-label">Plain-English summary<\/span>/);
});

Deno.test("DocumentPageView: a one-section document has no TOC unless asked", () => {
	const single: Doc = { ...SAMPLE_DOC, sections: [SAMPLE_DOC.sections[0]] };
	const bare = renderToString(<DocumentPageView doc={single} islands={STATIC_DOCUMENT_ISLANDS} />);
	assertFalse(bare.includes("<nav"));
	const forced = renderToString(
		<DocumentPageView doc={single} toc islands={STATIC_DOCUMENT_ISLANDS} />,
	);
	assertMatch(forced, /<nav id="doc-toc"/);
});
// #endregion
