/**
 * The legal pages as the server renders them (Decision #270): the document (normal, pinned to an
 * old version, comparing) and the hub. Rendered with the static islands, exactly as a page test of an
 * editorial surface must (the islands import CSS, which `deno test` cannot load).
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { resolveLegalDocument } from "../core/view.ts";
import { currentVersion, LEGAL_GROUPS, legalFamily } from "../core/registry.ts";
import {
	compareCounts,
	LegalDocumentViewComponent,
	STATIC_LEGAL_ISLANDS,
	versionOptionLabel,
} from "./LegalDocumentView.tsx";
import { LegalHubView } from "./LegalHubView.tsx";

const TODAY = "2026-10-17";

/** Render the document page for `query`. */
function renderDoc(slug: string, query = ""): string {
	const request = resolveLegalDocument(slug, new URLSearchParams(query), TODAY);
	if (request.kind !== "document") throw new Error(`expected a document, got ${request.kind}`);
	return tidy(renderToString(
		<LegalDocumentViewComponent view={request.view} today={TODAY} islands={STATIC_LEGAL_ISLANDS} />,
	));
}

/** One spelling per tag: the precompiled JSX may leave a double space after a tag name. */
function tidy(html: string): string {
	return html.replace(/<(\w+)\s+/g, "<$1 ");
}

/** Count of `needle` in `hay`. */
function count(hay: string, needle: string | RegExp): number {
	return typeof needle === "string"
		? hay.split(needle).length - 1
		: (hay.match(needle) ?? []).length;
}

// #region Document
Deno.test("legal document: one h1, the draft disclosure, the version and dates, numbered clauses", () => {
	const html = renderDoc("escrow-terms");
	assertEquals(count(html, /<h1[\s>]/g), 1);
	assertEquals(count(html, "<main"), 0, "the shell owns the main landmark");
	assertMatch(html, /role="note"[^>]*aria-labelledby="lgl-draft-title"/);
	assert(html.includes("Draft — pending legal review"));
	assert(html.includes("Version 2.0"));
	// P0's DocumentDate straight into the facts line: its items keep their content in flow, so the
	// prefix keeps its space without a wrapper.
	assertMatch(
		html,
		/<li class="ui-doc-header__meta-item"><span class="ui-doc-header__sep" aria-hidden="true">·<\/span>Effective <time datetime="2026-10-17">17 October 2026<\/time><\/li>/,
	);
	assert(html.includes("ui-doc--clauses"));
	assert(html.includes("ui-doc-body--numbered"));
	assertMatch(
		html,
		/<h2 id="pending-window"[^>]*>.*?<span class="ui-anchor-heading__num">6<\/span>/s,
	);
	assert(html.includes("Plain-English summary"));
	assert(html.includes("What changed in version 2.0:"));
	// Compare is one tap from the top at every width, not only in the meta rail.
	assertMatch(
		html,
		/<a class="lgl-link" href="\/legal\/escrow-terms\?compare=1\.0">Compare with version 1\.0<\/a>/,
	);
});

Deno.test("legal document: the rail is a 'Legal documents' nav of every document, this one current", () => {
	const html = renderDoc("privacy");
	assertMatch(html, /<nav id="doc-toc" class="ui-toc" aria-label="Legal documents">/);
	for (
		const slug of [
			"terms",
			"privacy",
			"cookies",
			"acceptable-use",
			"escrow-terms",
			"ip-transfer-deed",
		]
	) {
		assert(html.includes(`href="/legal/${slug}"`), slug);
	}
	assertMatch(html, /href="\/legal\/privacy" aria-current="page"/);
	assert(html.includes('href="#what-we-collect"'), "the current document expands into its clauses");
});

Deno.test("legal document: the meta rail carries the version controls; the foot links help and the hub", () => {
	const html = renderDoc("terms");
	assertMatch(html, /<aside class="ui-doc__meta" aria-label="Versions and downloads">/);
	assert(html.includes('data-static-controls="terms"'));
	assert(html.includes('href="/contact?intent=support"'));
	assert(html.includes('href="/legal"'));
});

Deno.test("legal document: an old version says what replaced it and links the current one", () => {
	const html = renderDoc("terms", "v=1.0");
	assert(html.includes("You are reading version 1.0, which was replaced by version 2.0"));
	assert(html.includes("Read the current version"));
	assert(html.includes("Opening platform credit"));
	assertFalse(html.includes("What changed in version"), "the first version has nothing it changed");
	assert(
		html.includes("About version 1.0: A reconstructed baseline, never published"),
		"the reconstructed baseline says what it is",
	);
});

Deno.test("legal document: comparing marks changed clauses, ins/del with spoken labels, folds the rest", () => {
	const html = renderDoc("terms", "compare=1.0");
	assert(html.includes("Showing what changed from version 1.0 to version 2.0"));
	assert(html.includes("Stop comparing"));
	assertMatch(html, /class="ui-doc-section lgl-clause lgl-clause--changed"/);
	assertMatch(html, /class="ui-doc-section lgl-clause lgl-clause--added"/);
	assertMatch(html, /class="ui-doc-section lgl-clause lgl-clause--removed"/);
	assertMatch(html, /<p class="lgl-clause__change" id="age-change">Changed in version 2\.0<\/p>/);
	assertMatch(html, /role="group" aria-labelledby="age" aria-describedby="age-change"/);
	assertMatch(html, /<ins class="lgl-diff__ins"><span class="ui-visually-hidden">Added: <\/span>/);
	assertMatch(
		html,
		/<del class="lgl-diff__del"><span class="ui-visually-hidden">Removed: <\/span>/,
	);
	assertMatch(html, /Removed in version 2\.0 \(was clause \d+\)/);
	assertMatch(html, /<details class="lgl-unchanged">/);
	assert(html.includes("unchanged clause"));
	// The rail lists only what changed (an unchanged clause keeps its own heading link, folded).
	const rail = html.slice(html.indexOf('<nav id="doc-toc"'), html.indexOf("</nav>"));
	assert(rail.includes('href="#hiring"'));
	assert(rail.includes('href="#opening-credit"'));
	assertFalse(rail.includes('href="#about"'), "an unchanged clause is not in the rail");
	assert(html.includes('<a class="ui-anchor-heading__link" href="#about">'));
	// A removed clause keeps the rail's text column: a dash where its number would be.
	assertMatch(
		rail,
		/<span class="ui-toc__num">–<\/span><span class="ui-toc__text"><span class="ui-toc__text-ink">Opening platform credit/,
	);
	// An added paragraph keeps its authored link inside the insertion.
	const age = html.slice(html.indexOf('aria-labelledby="age"'), html.indexOf('id="roles"'));
	assertMatch(
		age,
		/<ins class="lgl-diff__ins"><span class="ui-visually-hidden">Added: <\/span>[^]*?href="#verification-and-payouts"/,
	);
});

Deno.test("legal document: a compared table is drawn as a table — caption, column and row headers", () => {
	const html = renderDoc("escrow-terms", "compare=1.0");
	const release = html.slice(html.indexOf('id="release-change"'), html.indexOf('id="fees"'));
	assertMatch(
		release,
		/<div class="ui-prose__table" role="region" aria-label="When escrow is released" tabindex="0"><table><caption>When escrow is released<\/caption><thead><tr ?><th scope="col">Kind of work<\/th><th scope="col">Escrow is released<\/th><\/tr><\/thead><tbody><tr ?><th scope="row">One-off project or Task<\/th>/,
	);
	assertFalse(html.includes("lgl-diff__row"), "no row flattened into a paragraph");
	assertMatch(release, /<td ?>[^]*?<ins class="lgl-diff__ins/);
});

Deno.test("legal document: a single-version document offers no compare and says why", () => {
	const html = renderDoc("cookies");
	assertFalse(html.includes("What changed in version"));
	assertFalse(html.includes("lgl-compare"));
});

Deno.test("versionOptionLabel and compareCounts read as sentences", () => {
	assertEquals(
		versionOptionLabel({
			version: "2.0",
			effectiveDate: TODAY,
			reviewedAt: null,
			changeSummary: "",
			status: "current",
		}),
		"2.0 — current",
	);
	assertEquals(
		versionOptionLabel({
			version: "1.0",
			effectiveDate: "2026-08-01",
			reviewedAt: null,
			changeSummary: "",
			status: "superseded",
		}),
		"1.0 — effective 1 August 2026",
	);
	assertEquals(
		compareCounts({
			from: "1",
			to: "2",
			clauses: [],
			counts: { changed: 1, added: 2, removed: 0, unchanged: 3 },
		}),
		"1 clause changed, 2 added, 3 unchanged",
	);
});
// #endregion

// #region Hub
Deno.test("legal hub: one h1, the library draft disclosure, every document as a plain list row", () => {
	const groups = LEGAL_GROUPS.map((g) => ({
		id: g.id,
		label: g.label,
		entries: g.slugs.map((slug) => ({ doc: currentVersion(legalFamily(slug)!, TODAY) })),
	}));
	const html = tidy(renderToString(<LegalHubView groups={groups} draft />));
	assertEquals(count(html, /<h1[\s>]/g), 1);
	assertEquals(count(html, '<li class="lgl-hub__row">'), 6);
	assertFalse(html.includes("ui-card"), "no cards");
	assert(html.includes("Draft — pending legal review"));
	assertMatch(html, /<nav class="lgl-hub__docs" aria-label="Legal documents">/);
	assertMatch(html, /<a class="lgl-hub__link" href="\/legal\/terms">Terms of Service<\/a>/);
	assert(html.includes("For everyone"));
	assert(html.includes("For work and payments"));
	// Every fact opens with its separator inside a clipping wrapper, so no wrapped line starts with one.
	assertMatch(
		html,
		/<div class="lgl-facts"><ul class="lgl-facts__list"><li class="lgl-facts__item"><span class="lgl-facts__sep" aria-hidden="true">·<\/span>Version 2\.0/,
	);
	assertEquals(count(html, '<span class="lgl-facts__sep" aria-hidden="true">·</span>'), 6 * 4);
	assertMatch(
		html,
		/<span class="lgl-facts__sep" aria-hidden="true">·<\/span>Updated <time datetime="2026-10-17">/,
	);
	assert(html.includes('href="/contact?intent=support"'));
});
// #endregion
