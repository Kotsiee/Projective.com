/**
 * The editorial family's render contract, pinned on the shared sample document.
 *
 * What a reviewer cannot see by reading the components, and what these assert on the real SSR
 * string: the landmarks a screen reader navigates by (one article named by its title, one "On this
 * page" nav, the meta aside — and NO second `<main>`, which the shell owns); that every heading id
 * is unique and every table-of-contents link lands on one; that each node type maps to its semantic
 * element; and that no author string can become markup.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { anchorDoc, type Doc, docToc } from "@projective/types/content";
import { SAMPLE_DOC } from "@projective/types/content/fixtures";
import {
	ContentRenderer,
	DocumentBody,
	DocumentHeader,
	DocumentLayout,
	EditorialGlyphContext,
	type EditorialGlyphs,
	TocNav,
} from "../editorial.ts";

// #region Helpers
const anchored = anchorDoc(SAMPLE_DOC);
const toc = docToc(anchored);

/** The sample rendered the way a consumer page composes it. */
function page(options: { meta?: boolean; toc?: boolean; numbered?: boolean } = {}): string {
	const a = options.numbered ? anchorDoc(SAMPLE_DOC, { numbered: true }) : anchored;
	return renderToString(
		<DocumentLayout
			header={
				<DocumentHeader
					eyebrow="Help"
					title={SAMPLE_DOC.title}
					summary={SAMPLE_DOC.summary}
					meta={["Updated 17 October 2026", "Version 1.0", "1 min read"]}
				/>
			}
			toc={options.toc === false ? undefined : <TocNav entries={docToc(a)} />}
			meta={options.meta ? <p>Related</p> : undefined}
		>
			<DocumentBody doc={a} />
		</DocumentLayout>,
	);
}

/** Every `id="…"` value in an HTML string. */
function ids(html: string): string[] {
	return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

/** Every in-page `href="#…"` target in an HTML string. */
function fragments(html: string): string[] {
	return [...html.matchAll(/\shref="#([^"]+)"/g)].map((m) => m[1]);
}

/** Count of `needle` in `hay`. */
function count(hay: string, needle: string): number {
	return hay.split(needle).length - 1;
}

/** A one-section document holding `body`. */
function docWith(body: Doc["sections"][number]["body"]): Doc {
	return {
		id: "t",
		slug: "t",
		title: "T",
		summary: "S",
		updatedAt: "2026-10-17",
		version: "1",
		sections: [{ id: "only", heading: "Only", body }],
	};
}
// #endregion

// #region Landmarks
Deno.test("landmarks: one article named by its title, one 'On this page' nav, no second main", () => {
	const html = page({ meta: true });
	assertEquals(count(html, "<article"), 1);
	assertMatch(
		html,
		/<article id="doc-article" class="ui-doc__article ui-doc__article--toc ui-doc__article--meta" aria-labelledby="doc-title">/,
	);
	assertEquals(count(html, "<h1"), 1);
	assertMatch(
		html,
		/<h1 id="doc-title" class="ui-doc-header__title">How stage payments work<\/h1>/,
	);
	assertEquals(count(html, "<nav"), 1);
	assertMatch(html, /<nav id="doc-toc" class="ui-toc" aria-label="On this page">/);
	assertMatch(html, /<aside class="ui-doc__meta" aria-label="About this document">/);
	assertFalse(html.includes("<main"), "the shell owns the page's one <main>");
});

Deno.test("rails are reserved only for the slots that were given", () => {
	const bare = page({ toc: false });
	assertMatch(
		bare,
		/<article id="doc-article" class="ui-doc__article" aria-labelledby="doc-title">/,
	);
	assertFalse(bare.includes("ui-doc__toc"));
	assertFalse(bare.includes("<aside"));
});

Deno.test("the header's facts are one list with aria-hidden middots between items", () => {
	const html = page();
	assertMatch(html, /<ul class="ui-doc-header__meta" role="list">/);
	assertEquals(count(html, '<span class="ui-doc-header__sep" aria-hidden="true">·</span>'), 2);
	assertMatch(html, /<p class="ui-doc-header__eyebrow">Help<\/p>/);
});
// #endregion

// #region Heading ids
Deno.test("every id on the page is unique, and stable across renders", () => {
	const html = page({ meta: true });
	const all = ids(html);
	assertEquals(all.length, new Set(all).size, `duplicate ids: ${all.join(", ")}`);
	assertEquals(page({ meta: true }), html);
});

Deno.test("every table-of-contents link and heading link lands on a rendered id", () => {
	const html = page();
	const present = new Set(ids(html));
	const targets = fragments(html);
	assert(targets.length > 0);
	for (const target of targets) assert(present.has(target), `#${target} has no target`);
	for (
		const id of [
			"overview",
			"an-example",
			"an-example-2",
			"fees",
			"worked-numbers",
			"releases",
			"releases-2",
		]
	) {
		assert(present.has(id), id);
	}
});

Deno.test("headings are real links to themselves; sections are h2, sub-headings h3", () => {
	const html = page();
	assertMatch(
		html,
		/<h2 id="fees" class="ui-anchor-heading ui-anchor-heading--2"><a class="ui-anchor-heading__link" href="#fees"><span class="ui-anchor-heading__text">Fees<\/span><\/a><\/h2>/,
	);
	assertMatch(
		html,
		/<h3 id="an-example-2" class="ui-anchor-heading ui-anchor-heading--3"><a class="ui-anchor-heading__link" href="#an-example-2">/,
	);
	assertEquals(count(html, "<h2"), SAMPLE_DOC.sections.length);
});

Deno.test("numbered documents print clause numbers in headings and the TOC", () => {
	const html = page({ numbered: true });
	assertMatch(html, /<h2 id="fees"[^>]*><a[^>]*><span class="ui-anchor-heading__num">2<\/span>/);
	assertMatch(
		html,
		/<h3 id="worked-numbers"[^>]*><a[^>]*><span class="ui-anchor-heading__num">2\.1<\/span>/,
	);
	assertMatch(html, /<a class="ui-toc__link" href="#fees"><span class="ui-toc__num">2<\/span>/);
});
// #endregion

// #region Node renderers
Deno.test("p, strong, em, code and links render as phrasing elements", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(html, /<strong>stages<\/strong>/);
	assertMatch(html, /<em>start<\/em>/);
	assertMatch(html, /<code class="ui-prose__code">submits<\/code>/);
	assertMatch(html, /<a href="\/help\/escrow">how payment protection works<\/a>/);
	assertMatch(html, /<a href="#fees">fees<\/a>/);
});

Deno.test("an external link opens with noopener; an internal one does not", () => {
	const html = renderToString(
		<ContentRenderer
			nodes={[{
				type: "p",
				content: [{ type: "link", href: "https://stripe.com", text: "Stripe" }, {
					type: "link",
					href: "/a",
					text: "A",
				}],
			}]}
		/>,
	);
	assertMatch(html, /<a href="https:\/\/stripe.com" rel="noopener noreferrer">Stripe<\/a>/);
	assertMatch(html, /<a href="\/a">A<\/a>/);
});

Deno.test("lists render ul/ol and nest", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<ol><li>The client funds the first stage\.<\/li><li>The freelancer delivers and <code class="ui-prose__code">submits<\/code> the work\.<ul><li>Files are attached/,
	);
	assertMatch(html, /<ul><li>Check your payout details are verified\.<\/li>/);
});

Deno.test("quote renders blockquote with its cite", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<blockquote class="ui-prose__quote"><p>Knowing the stage was funded meant I could start on day one\.<\/p><cite class="ui-prose__cite">A freelancer on the platform<\/cite><\/blockquote>/,
	);
});

Deno.test("code renders pre > code with its language, keyboard-scrollable", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<pre class="ui-prose__pre" data-lang="text" tabindex="0"><code class="language-text">fee {6}= stage price × 0\.05\nreleased = stage price − fee<\/code><\/pre>/,
	);
});

Deno.test("images carry intrinsic dimensions, alt, lazy loading and their caption", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<figure class="ui-prose__figure"><img class="ui-prose__img" src="https:\/\/placehold\.co\/1200x675\?text=Stage\+timeline" alt="A timeline of three stages: funded, in progress, approved" width="1200" height="675" loading="lazy" decoding="async"\/><figcaption class="ui-prose__caption">Each stage moves from funded to approved on its own\.<\/figcaption><\/figure>/,
	);
});

Deno.test("callouts are notes that always print their tone word", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<div class="ui-callout ui-callout--important" role="note"><p class="ui-callout__title"><span>Important<\/span><\/p>/,
	);
	assertMatch(
		html,
		/<div class="ui-callout ui-callout--tip" role="note"><p class="ui-callout__title"><span>Tip<\/span><span class="ui-callout__sep" aria-hidden="true">·<\/span><span>Before you withdraw<\/span><\/p>/,
	);
});

Deno.test("tables carry a caption, column headers and row headers in a named scroll region", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<div class="ui-prose__table" role="region" tabindex="0" aria-label="A £1,000 stage, released"><table><caption>A £1,000 stage, released<\/caption>/,
	);
	assertEquals(count(html, '<th scope="col">'), 2);
	assertMatch(html, /<tr><th scope="row">Stage price<\/th><td>£1,000\.00<\/td><\/tr>/);
});

Deno.test("the section summary line renders under its heading with its label", () => {
	const html = renderToString(<DocumentBody doc={anchored} />);
	assertMatch(
		html,
		/<\/h2><p class="ui-doc-section__tldr"><span class="ui-doc-section__tldr-label">In short<\/span>Money for a stage/,
	);
});

Deno.test("a bare node list still gets unique sub-heading ids", () => {
	const html = renderToString(
		<ContentRenderer
			nodes={[{ type: "h3", text: "Same" }, { type: "h3", text: "Same" }, {
				type: "h3",
				text: "x",
				id: "same-2",
			}]}
		/>,
	);
	assertEquals(ids(html), ["same", "same-3", "same-2"]);
});
// #endregion

// #region No markup from content
Deno.test("author strings are text: markup in content is escaped, never parsed", () => {
	const hostile = '<script>alert(1)</script><img src=x onerror="alert(1)">';
	const doc = anchorDoc(docWith([
		{ type: "p", content: hostile },
		{ type: "list", items: [hostile] },
		{ type: "table", head: [hostile], rows: [[hostile]] },
		{ type: "callout", tone: "note", title: hostile, body: [{ type: "p", content: hostile }] },
	]));
	const html = renderToString(<DocumentBody doc={doc} />);
	assertFalse(html.includes("<script"), "a script tag reached the output");
	assertFalse(html.includes("<img src=x"), "an image tag reached the output");
	assert(html.includes("&lt;script>alert(1)&lt;/script>"));
});

Deno.test("no editorial component reaches for innerHTML", () => {
	for (
		const file of [
			"AnchorHeading.tsx",
			"ContentRenderer.tsx",
			"DocumentBody.tsx",
			"DocumentHeader.tsx",
			"DocumentLayout.tsx",
			"InlineContent.tsx",
			"Prose.tsx",
			"TocNav.tsx",
			"../islands/TableOfContents.island.tsx",
			"../islands/ReadingProgress.island.tsx",
		]
	) {
		// Code only: the components' own JSDoc names the rule it states.
		const code = Deno.readTextFileSync(new URL(file, import.meta.url))
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		assertFalse(/dangerouslySetInnerHTML|innerHTML|outerHTML/.test(code), file);
	}
});
// #endregion

// #region Glyphs and the TOC
Deno.test("glyphs come from the context and are decorative; without one there are none", () => {
	const glyphs: EditorialGlyphs = {
		anchor: () => <span data-glyph="anchor" />,
		callout: { tip: () => <span data-glyph="tip" /> },
	};
	const withGlyphs = renderToString(
		<EditorialGlyphContext.Provider value={glyphs}>
			<DocumentBody doc={anchored} />
		</EditorialGlyphContext.Provider>,
	);
	assertMatch(
		withGlyphs,
		/<span class="ui-anchor-heading__glyph" aria-hidden="true"><span data-glyph="anchor"><\/span><\/span>/,
	);
	assertMatch(
		withGlyphs,
		/<span class="ui-callout__glyph" aria-hidden="true"><span data-glyph="tip"><\/span><\/span>/,
	);
	const without = renderToString(<DocumentBody doc={anchored} />);
	assertFalse(without.includes("ui-anchor-heading__glyph"));
	assertFalse(without.includes("ui-callout__glyph"));
});

Deno.test("the TOC marks the current section and names it on the sheet trigger", () => {
	const html = renderToString(<TocNav entries={toc} activeId="fees" enhanced sheetOpen={false} />);
	assertEquals(count(html, 'aria-current="location"'), 2, "the rail list and the disclosure list");
	assertMatch(html, /<a class="ui-toc__link" href="#fees" aria-current="location">/);
	assertMatch(html, /<nav id="doc-toc" class="ui-toc" aria-label="On this page" data-enhanced>/);
	assertMatch(
		html,
		/<button type="button" class="ui-toc__sheet-trigger" aria-haspopup="dialog" aria-expanded="false"><span class="ui-toc__label">On this page<\/span><span class="ui-toc__current">Fees<\/span><\/button>/,
	);
	assertMatch(html, /<details class="ui-toc__disclosure"><summary class="ui-toc__summary">/);
	assertMatch(html, /<ol id="doc-toc-list" class="ui-toc__list ui-toc__list--root" role="list">/);
});

Deno.test("before hydration the TOC is not enhanced and marks nothing", () => {
	const html = renderToString(<TocNav entries={toc} />);
	assertFalse(html.includes("data-enhanced"));
	assertFalse(html.includes("aria-current"));
});
// #endregion
