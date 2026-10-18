import { assert, assertEquals } from "@std/assert";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import { serializeJsonLd } from "@features/marketing/core/seo.ts";
import {
	articleJsonLdGraph,
	articleMeta,
	articlesIndexJsonLd,
	articlesIndexMeta,
	articlesIndexTitle,
} from "./article-seo.ts";

/**
 * The `<head>` and structured data of the article surfaces (P6): one canonical per page (an article
 * at `/articles/<slug>`, every index view at `/articles`), an `article` Open Graph block carrying the
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

Deno.test("every index view is canonical at /articles and leads with the lead story's cover", async () => {
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
