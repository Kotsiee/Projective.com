import { assert, assertEquals } from "@std/assert";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import { serializeJsonLd } from "@features/marketing/core/seo.ts";
import {
	articleJsonLdGraph,
	articleMeta,
	articlesIndexCanonicalPath,
	articlesIndexJsonLd,
	articlesIndexMeta,
	articlesIndexTitle,
} from "./article-seo.ts";

/**
 * The `<head>` and structured data of the article surfaces (P6): one canonical per page (an article
 * at `/articles/<slug>`, page 1 of every index view at `/articles`, a later page at its own address),
 * an `article` Open Graph block carrying the
 * cover, a CollectionPage + ItemList for the index and an Article + BreadcrumbList for the reader.
 */

const ORIGIN = "https://projective.app";
const fixture = { source: "fixture" as const, now: new Date("2026-10-17T12:00:00Z") };

/** The graph's node of a type. */
function node(graph: { "@graph": Array<Record<string, unknown>> }, type: string) {
	const found = graph["@graph"].find((n) => n["@type"] === type);
	assert(found, `no ${type} node`);
	return found;
}

Deno.test("index titles name the filter and the page", () => {
	assertEquals(articlesIndexTitle({ topics: [], page: 1 }), "Articles");
	assertEquals(
		articlesIndexTitle({ topics: ["value-pricing"], page: 1 }),
		"Articles: Value pricing",
	);
	assertEquals(
		articlesIndexTitle({ topics: ["agile-delivery", "escrow-and-trust"], page: 2 }),
		"Articles: Agile delivery, Escrow & trust · Page 2",
	);
});

Deno.test("page 1 of a filtered view is canonical at /articles and leads with the lead's cover", async () => {
	const result = await EditorialArticlesBackendService.index(
		{ topics: ["value-pricing"], page: 1 },
		fixture,
	);
	assert(result.ok && result.data);
	const meta = articlesIndexMeta(result.data, ORIGIN);
	assertEquals(meta.canonical, "https://projective.app/articles");
	assertEquals(meta.title, "Articles: Value pricing · Projective");
	assertEquals(meta.robots, "index, follow");
	assertEquals(meta.og.image?.url, `${ORIGIN}${result.data.items[0].cover.src}`);

	const graph = articlesIndexJsonLd(result.data, ORIGIN);
	JSON.parse(serializeJsonLd(graph));
	const page = node(graph, "CollectionPage");
	const list = page.mainEntity as {
		"@type": string;
		itemListElement: Array<{ url: string; position: number }>;
	};
	assertEquals(list["@type"], "ItemList");
	assertEquals(list.itemListElement.length, result.data.items.length);
	assertEquals(list.itemListElement[0].url, `${ORIGIN}/articles/${result.data.items[0].slug}`);
	const crumbs = node(graph, "BreadcrumbList").itemListElement as Array<{ item: string }>;
	assertEquals(crumbs.map((c) => c.item), [`${ORIGIN}/`, `${ORIGIN}/articles`]);
});

Deno.test("a later index page is its own canonical, in the head and in the CollectionPage", async () => {
	const result = await EditorialArticlesBackendService.index({ topics: [], page: 1 }, fixture);
	assert(result.ok && result.data);
	assertEquals(articlesIndexCanonicalPath({ topics: [], page: 1 }), "/articles");
	assertEquals(articlesIndexCanonicalPath({ topics: ["value-pricing"], page: 1 }), "/articles");
	assertEquals(
		articlesIndexCanonicalPath({ topics: ["value-pricing"], page: 3 }),
		"/articles?topic=value-pricing&page=3",
	);

	const second = { ...result.data, page: 2, pageCount: 2 };
	const meta = articlesIndexMeta(second, ORIGIN);
	assertEquals(meta.canonical, `${ORIGIN}/articles?page=2`);
	assertEquals(meta.og.url, `${ORIGIN}/articles?page=2`);
	const graph = articlesIndexJsonLd(second, ORIGIN);
	JSON.parse(serializeJsonLd(graph));
	const page = node(graph, "CollectionPage");
	assertEquals(page.url, `${ORIGIN}/articles?page=2`);
	assertEquals(page["@id"], `${ORIGIN}/articles?page=2#webpage`);
	// The trail is still Home › Articles, and the page still points at it.
	const crumbs = node(graph, "BreadcrumbList");
	assertEquals((page.breadcrumb as { "@id": string })["@id"], crumbs["@id"]);
});

Deno.test("an article: one canonical, an article OG block, and an Article with author, image and count", async () => {
	const result = await EditorialArticlesBackendService.article("no-hold-no-work", fixture);
	assert(result.ok && result.data);
	const meta = articleMeta(result.data, ORIGIN);
	assertEquals(meta.canonical, "https://projective.app/articles/no-hold-no-work");
	assertEquals(meta.og.type, "article");
	assertEquals(meta.og.publishedAt, "2026-10-08T08:00:00.000Z");
	assertEquals(meta.og.modifiedAt, "2026-10-12T09:30:00.000Z");
	assertEquals(meta.og.image?.width, result.data.article.cover.w);
	assertEquals(meta.twitterCard, "summary_large_image");

	const graph = articleJsonLdGraph(result.data, ORIGIN);
	JSON.parse(serializeJsonLd(graph));
	const article = node(graph, "Article");
	assertEquals(article.headline, result.data.article.title);
	assertEquals(article.datePublished, "2026-10-08T08:00:00.000Z");
	assertEquals(article.dateModified, "2026-10-12T09:30:00.000Z");
	assertEquals(article.wordCount, result.data.article.wordCount);
	assertEquals(article.articleSection, "Escrow & trust");
	assertEquals(article.author, {
		"@type": "Organization",
		name: "Projective Editorial",
		url: `${ORIGIN}/articles`,
	});
	assertEquals((article.image as { "@type": string })["@type"], "ImageObject");
	const crumbs = node(graph, "BreadcrumbList").itemListElement as Array<{ name: string }>;
	assertEquals(crumbs.map((c) => c.name), ["Home", "Articles", result.data.article.title]);
	assertEquals(node(graph, "WebPage").breadcrumb, {
		"@id": "https://projective.app/articles/no-hold-no-work#breadcrumb",
	});
});
