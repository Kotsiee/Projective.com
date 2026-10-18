import { assert, assertEquals, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import type { EditorialArticleIndex } from "@projective/types/editorial";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import {
	type DocumentPageProps,
	DocumentPageView,
	STATIC_DOCUMENT_ISLANDS,
} from "@features/marketing/components/DocumentPageView.tsx";
import { ArticlesIndexView, indexSummary } from "./ArticlesIndexView.tsx";
import { ArticleReaderView } from "./ArticleReaderView.tsx";

/**
 * The article surfaces as the server renders them (P6): exactly one `<h1>`, the landmarks and roles a
 * reader relies on, a reserved box on every picture, the lead/cover as the only high-priority image,
 * the topic filter's state announced, and on the reader the table of contents, the byline as the
 * article's `<address>`, one call to action and related reading. The reader renders through
 * `DocumentPageView` with the static islands, exactly as the route's `DocumentPage` does before
 * hydration.
 */

const fixture = { source: "fixture" as const, now: new Date("2026-10-17T12:00:00Z") };

/** Occurrences of `needle`. */
function count(html: string, needle: string | RegExp): number {
	return typeof needle === "string"
		? html.split(needle).length - 1
		: [...html.matchAll(new RegExp(needle, "g"))].length;
}

/** Every `<img …>` tag. */
function images(html: string): string[] {
	return [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
}

async function index(topics: EditorialArticleIndex["topics"] = []): Promise<EditorialArticleIndex> {
	const result = await EditorialArticlesBackendService.index({ topics, page: 1 }, fixture);
	assert(result.ok && result.data);
	return result.data;
}

const StaticDocument = (props: DocumentPageProps) => (
	<DocumentPageView {...props} islands={STATIC_DOCUMENT_ISLANDS} />
);

// #region Index
Deno.test("index: one h1, a lead, two features and the grid, every picture's box reserved", async () => {
	const html = renderToString(<ArticlesIndexView index={await index()} />);
	assertEquals(count(html, "<h1"), 1);
	assertEquals(count(html, 'class="artl-tile artl-tile--lead"'), 1);
	assertEquals(count(html, 'class="artl-tile artl-tile--feature"'), 2);
	assertEquals(count(html, 'class="artl-tile artl-tile--grid"'), 3);
	const imgs = images(html);
	assertEquals(imgs.length, 6);
	for (const img of imgs) {
		assertMatch(img, /\swidth="\d+"/);
		assertMatch(img, /\sheight="\d+"/);
		// A tile's cover is decoration: the title link names the card.
		assertMatch(img, /\salt=""/);
	}
	assertEquals(imgs.filter((img) => img.includes('fetchpriority="high"')).length, 1);
	assert(imgs[0].includes('fetchpriority="high"') && imgs[0].includes('loading="eager"'));
	assert(
		imgs.slice(1).every((img) => img.includes('loading="lazy"') && img.includes("data-artl-fade")),
	);
	// Each tile is ONE link, named by its title.
	assertEquals(count(html, 'class="artl-tile__link"'), 6);
	assertMatch(html, /<time\s+datetime="2026-10-14T08:00:00.000Z">14 Oct 2026<\/time>/);
	// A middot closes the fact before it, so a wrapped meta line never starts with a separator.
	assertEquals(count(html, '<li class="artl-meta__item"><span class="artl-meta__sep"'), 0);
	assertEquals(
		count(html, /<span class="artl-meta__sep" aria-hidden="true">·<\/span><\/li><\/ul>/),
		0,
	);
	assert(count(html, "artl-meta__sep") > 0);
});

Deno.test("index: the topic filter is a nav of links whose chosen chips are aria-current", async () => {
	const filtered = await index(["value-pricing"]);
	const html = renderToString(<ArticlesIndexView index={filtered} />);
	assertMatch(html, /<nav class="artl-topics" aria-labelledby="artl-topics-label">/);
	assertEquals(count(html, 'class="artl-topic"'), 6);
	assertEquals(count(html, 'aria-current="true"'), 1);
	assertMatch(html, /href="\/articles" class="artl-topic"|class="artl-topic" href="\/articles"/);
	// The chosen state is announced once, by aria-current — not again in the hidden text.
	assertMatch(
		html,
		/aria-current="true">(?:(?!<\/a>).)*Value pricing<\/span>(?:(?!<\/a>).)*, 3 articles<\/span>/s,
	);
	assertEquals(count(html, ", selected"), 0);
	assertEquals(indexSummary(filtered), "3 articles on Value pricing");
	assertEquals(
		indexSummary({ total: 1, topics: ["agile-delivery", "team-structure", "value-pricing"] }),
		"1 article on Agile delivery, Team structure or Value pricing",
	);
});

Deno.test("index: nothing matching is an empty state that offers every topic, still one h1", () => {
	const empty: EditorialArticleIndex = {
		topics: ["escrow-and-trust"],
		items: [],
		page: 1,
		pageCount: 1,
		total: 0,
		topicCounts: {
			"async-collaboration": 0,
			"agile-delivery": 0,
			"team-structure": 0,
			"value-pricing": 0,
			"escrow-and-trust": 0,
		},
		publishedTotal: 0,
	};
	const html = renderToString(<ArticlesIndexView index={empty} />);
	assertEquals(count(html, "<h1"), 1);
	assertMatch(html, /Nothing on these topics yet/);
	assertMatch(html, /href="\/articles"[^>]*>|class="ui-button[^"]*" href="\/articles"/);
	assertEquals(images(html).length, 0);
	assertEquals(count(html, "artl-pager"), 0);
});

Deno.test("index: a later page is the grid alone, with a pager keeping the filter", async () => {
	const many = await index();
	const html = renderToString(
		<ArticlesIndexView index={{ ...many, page: 2, pageCount: 3, topics: ["agile-delivery"] }} />,
	);
	assertEquals(count(html, "artl-tile--lead"), 0);
	assertEquals(count(html, "artl-tile--grid"), many.items.length);
	assertMatch(html, /rel="prev" href="\/articles\?topic=agile-delivery"/);
	assertMatch(html, /rel="next" href="\/articles\?topic=agile-delivery&amp;page=3"/);
	assertMatch(html, /Page 2 of 3/);
	assert(images(html).every((img) => !img.includes('fetchpriority="high"')));
});
// #endregion

// #region Reader
Deno.test("reader: one h1, the article landmark, the TOC nav, the byline address and the cover", async () => {
	const result = await EditorialArticlesBackendService.article("no-hold-no-work", fixture);
	assert(result.ok && result.data);
	const page = result.data;
	const html = renderToString(
		<ArticleReaderView page={page} signedIn={false} Document={StaticDocument} />,
	);
	assertEquals(count(html, "<h1"), 1);
	assertMatch(
		html,
		/<article id="doc-article" class="ui-doc__article[^"]*" aria-labelledby="doc-title">/,
	);
	assertMatch(html, /<nav [^>]*aria-label="On this page"/);
	assertMatch(html, /class="ui-doc ui-doc--article"/);
	assertEquals(count(html, "<address"), 2);
	assertEquals(count(html, 'class="artl-byline artl-byline--lg"'), 1);
	// The reader's cover keeps its description; it is the article's picture, not a tile's.
	assertMatch(html, /<img class="artl-cover__img"[^>]*\salt="[^"]+"/);
	assertMatch(html, /Escrow &amp; trust/);
	assertMatch(html, /<time datetime="2026-10-08T08:00:00.000Z">8 October 2026<\/time>/);
	assertMatch(html, /Updated <time datetime="2026-10-12T09:30:00.000Z">12 October 2026<\/time>/);
	assertMatch(html, new RegExp(`${page.article.readMinutes} min read`));

	const imgs = images(html);
	assert(imgs.every((img) => /\swidth="\d+"/.test(img) && /\sheight="\d+"/.test(img)));
	const priority = imgs.filter((img) => img.includes('fetchpriority="high"'));
	assertEquals(priority.length, 1);
	assert(priority[0].includes('class="artl-cover__img"'));
	// The cover is the page's largest paint; every other picture (bylines, figures, related) is lazy.
	for (const img of imgs.filter((img) => !img.includes('class="artl-cover__img"'))) {
		assertMatch(img, /\sloading="lazy"/);
	}

	// Every section heading is in the table of contents, by the same id.
	for (const section of page.article.sections) {
		assertMatch(html, new RegExp(`id="${section.id}"`));
		assertMatch(html, new RegExp(`href="#${section.id}"`));
	}
});

Deno.test("reader: exactly one call to action, inside the reading, guest-aware", async () => {
	const result = await EditorialArticlesBackendService.article("agile-delivery-in-stages", fixture);
	assert(result.ok && result.data);
	const guest = renderToString(
		<ArticleReaderView page={result.data} signedIn={false} Document={StaticDocument} />,
	);
	assertEquals(count(guest, 'class="artl-cta"'), 1);
	// On paper the call to action is a box and a link nobody can follow.
	assertMatch(guest, /<aside class="artl-cta" aria-labelledby="artl-cta-title" data-print="hide">/);
	assertEquals(count(guest, "ui-button--filled"), 1);
	assertMatch(guest, /Run your next project in stages/);
	assertMatch(
		guest,
		/class="ui-button ui-button--primary ui-button--filled ui-button--size-md artl-cta__action" href="\/join"/,
	);
	// It sits after a section that is not the last.
	const ctaAt = guest.indexOf('class="artl-cta"');
	const lastSection = result.data.article.sections.at(-1)!;
	assert(ctaAt < guest.indexOf(`id="${lastSection.id}"`));

	const member = renderToString(
		<ArticleReaderView page={result.data} signedIn Document={StaticDocument} />,
	);
	assertMatch(member, /href="\/projects\?create=1"/);
});

Deno.test("reader: the footer holds the author, the topics as filter links and related reading", async () => {
	const result = await EditorialArticlesBackendService.article(
		"ending-a-stage-early-fairly",
		fixture,
	);
	assert(result.ok && result.data);
	const html = renderToString(
		<ArticleReaderView page={result.data} signedIn={false} Document={StaticDocument} />,
	);
	assertMatch(html, /About the author/);
	assertMatch(html, /href="\/articles\?topic=escrow-and-trust"/);
	assertMatch(html, /href="\/articles\?topic=agile-delivery"/);
	assertEquals(count(html, "artl-tile--compact"), 3);
	assertMatch(html, /Related reading/);
	assertMatch(html, /href="\/articles"[^>]*>.*All articles/s);
});
// #endregion
