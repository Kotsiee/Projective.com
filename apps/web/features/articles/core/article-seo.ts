import {
	EDITORIAL_ARTICLE_TOPIC_LABEL,
	type EditorialArticleIndex,
	type EditorialArticlePage,
} from "@projective/types/editorial";
import {
	articleJsonLd,
	breadcrumbListJsonLd,
	collectionPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	webPageJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { articleHref, articlesIndexHref } from "./index-query.ts";

/**
 * article-seo.ts — the `<head>` facts and the structured data of `/articles` and `/articles/[slug]`
 * (P6). Pure: the route passes the site origin (`siteOrigin(ctx.url)`).
 *
 * One canonical per page (Decision #271): an article's is `/articles/<slug>`, and every spelling of
 * the index — a topic filter, a later page — names `/articles`, since each is a view of that one
 * collection. Member-authored posts are `/view` pages and never appear here.
 */

// #region Index
/** The index's lead paragraph and meta description. */
export const ARTICLES_INDEX_DESCRIPTION =
	"Field notes on running work in stages: asynchronous collaboration, agile delivery, team structure, value pricing, and the escrow that keeps both sides whole.";

/** The index's title for its current filter and page (`Articles`, `Articles: Value pricing · Page 2`). */
export function articlesIndexTitle(index: Pick<EditorialArticleIndex, "topics" | "page">): string {
	const topics = index.topics.map((topic) => EDITORIAL_ARTICLE_TOPIC_LABEL[topic]);
	const base = topics.length > 0 ? `Articles: ${topics.join(", ")}` : "Articles";
	return index.page > 1 ? `${base} · Page ${index.page}` : base;
}

/** The index's `<head>` facts. */
export function articlesIndexMeta(index: EditorialArticleIndex, origin: string): PageMeta {
	const lead = index.items[0];
	return pageMeta({
		title: articlesIndexTitle(index),
		description: ARTICLES_INDEX_DESCRIPTION,
		path: articlesIndexHref(),
		origin,
		...(lead ? { ogImage: lead.cover } : {}),
	});
}

/** The index's structured data: the organisation, the site, a CollectionPage + ItemList, crumbs. */
export function articlesIndexJsonLd(index: EditorialArticleIndex, origin: string): JsonLdGraph {
	const path = articlesIndexHref();
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		collectionPageJsonLd({
			origin,
			path,
			name: articlesIndexTitle(index),
			description: ARTICLES_INDEX_DESCRIPTION,
			breadcrumb: true,
			items: index.items.map((item) => ({ name: item.title, path: articleHref(item.slug) })),
		}),
		breadcrumbListJsonLd(origin, [{ name: "Home", path: "/" }, { name: "Articles", path }]),
	);
}
// #endregion

// #region Reader
/** An article's `<head>` facts: an `article` Open Graph block with its cover and dates. */
export function articleMeta(page: EditorialArticlePage, origin: string): PageMeta {
	const { article } = page;
	return pageMeta({
		title: article.title,
		description: article.standfirst,
		path: articleHref(article.slug),
		origin,
		ogType: "article",
		ogImage: article.cover,
		publishedAt: article.publishedAt,
		modifiedAt: article.updatedAt,
	});
}

/**
 * An article's structured data: the organisation and site, the page (linked to its breadcrumb
 * trail), the `Article` itself — headline, cover as an ImageObject, author, dates, section, word
 * count — and the trail Home › Articles › the article.
 *
 * The author is a `Person` for a named author and an `Organization` for a team byline; its `url` is
 * the author's profile, or the articles index for a byline that has none.
 */
export function articleJsonLdGraph(page: EditorialArticlePage, origin: string): JsonLdGraph {
	const { article, author } = page;
	const path = articleHref(article.slug);
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		webPageJsonLd({
			origin,
			path,
			name: article.title,
			description: article.standfirst,
			dateModified: article.updatedAt,
			breadcrumb: true,
		}),
		articleJsonLd({
			origin,
			path,
			headline: article.title,
			description: article.standfirst,
			datePublished: article.publishedAt,
			dateModified: article.updatedAt,
			authors: [{
				name: author.name,
				url: author.href ?? articlesIndexHref(),
				kind: author.kind === "team" ? "Organization" : "Person",
			}],
			image: article.cover,
			section: EDITORIAL_ARTICLE_TOPIC_LABEL[article.topics[0]],
			wordCount: article.wordCount,
		}),
		breadcrumbListJsonLd(origin, [
			{ name: "Home", path: "/" },
			{ name: "Articles", path: articlesIndexHref() },
			{ name: article.title, path },
		]),
	);
}
// #endregion
