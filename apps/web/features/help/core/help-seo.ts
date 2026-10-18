import { docText, wordCount } from "@projective/types/content/text";
import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";
import {
	breadcrumbListJsonLd,
	collectionPageJsonLd,
	type Crumb,
	faqPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	techArticleJsonLd,
	webPageJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import {
	HELP_ROOT,
	helpArticlePath,
	helpCategoryPath,
	type HelpCentreLibrary,
	type HelpCentreTopic,
} from "@server/services/editorial/help-library.ts";

/**
 * help-seo.ts — each help page's `<head>` facts and its schema.org graph (P2 work order §5). Pure: the
 * route passes its origin and the help library; the same input gives the same graph everywhere.
 *
 * | Page     | JSON-LD                                                    |
 * | :------- | :--------------------------------------------------------- |
 * | Hub      | CollectionPage (the topics) + FAQPage (the eight questions) |
 * | Category | CollectionPage (its articles) + BreadcrumbList             |
 * | Article  | TechArticle (headline, dateModified, articleSection) + its WebPage + BreadcrumbList |
 *
 * Every graph also carries the Organization and WebSite nodes the others point at by `@id`, so no
 * reference dangles. A page showing search results (`?q=`) is `noindex`: its canonical is the page
 * itself, and a results list is not content a search engine should keep.
 */

/** The hub's title and description. */
export const HELP_HUB_TITLE = "Help centre";
export const HELP_HUB_DESCRIPTION =
	"Answers about projects, stages, escrow, revisions, Fair Exit, payouts and verification on Projective, written from how the platform actually works.";

/** The breadcrumb root. */
const ROOT_CRUMB: Crumb = { name: HELP_HUB_TITLE, path: HELP_ROOT };

/** The `<head>` and graph of one page. */
export interface HelpPageSeo {
	meta: PageMeta;
	graph: JsonLdGraph;
}

/** The hub: its topics as a collection, and its FAQ. */
export function hubSeo(
	library: HelpCentreLibrary,
	origin: string,
	searching: boolean,
): HelpPageSeo {
	const faq = library.faq();
	return {
		meta: pageMeta({
			title: HELP_HUB_TITLE,
			description: HELP_HUB_DESCRIPTION,
			path: HELP_ROOT,
			origin,
			noindex: searching,
		}),
		graph: jsonLdGraph(
			organizationJsonLd(origin),
			webSiteJsonLd(origin),
			collectionPageJsonLd({
				origin,
				path: HELP_ROOT,
				name: HELP_HUB_TITLE,
				description: HELP_HUB_DESCRIPTION,
				items: library.topics.map((t) => ({
					name: t.category.title,
					path: helpCategoryPath(t.category.slug),
				})),
			}),
			faq.length > 0 &&
				faqPageJsonLd({
					origin,
					path: HELP_ROOT,
					items: faq.map((a) => ({ question: a.faq!.question, answer: a.summary })),
				}),
		),
	};
}

/** The breadcrumb trail to a category. */
export function categoryCrumbs(category: HelpCentreCategory): Crumb[] {
	return [ROOT_CRUMB, { name: category.title, path: helpCategoryPath(category.slug) }];
}

/** A category page: its articles as a collection, and its trail. */
export function categorySeo(
	topic: HelpCentreTopic,
	origin: string,
	searching: boolean,
): HelpPageSeo {
	const { category } = topic;
	const path = helpCategoryPath(category.slug);
	const title = `${category.title} — ${HELP_HUB_TITLE}`;
	return {
		meta: pageMeta({ title, description: category.description, path, origin, noindex: searching }),
		graph: jsonLdGraph(
			organizationJsonLd(origin),
			webSiteJsonLd(origin),
			collectionPageJsonLd({
				origin,
				path,
				name: category.title,
				description: category.description,
				breadcrumb: true,
				items: topic.articles.map((a) => ({ name: a.title, path: helpArticlePath(a) })),
			}),
			breadcrumbListJsonLd(origin, categoryCrumbs(category)),
		),
	};
}

/** The breadcrumb trail to an article. */
export function articleCrumbs(article: HelpCentreArticle, category: HelpCentreCategory): Crumb[] {
	return [...categoryCrumbs(category), { name: article.title, path: helpArticlePath(article) }];
}

/** An article: a TechArticle in its category's section, its page, and its trail. */
export function articleSeo(
	article: HelpCentreArticle,
	category: HelpCentreCategory,
	origin: string,
	searching: boolean,
): HelpPageSeo {
	const path = helpArticlePath(article);
	return {
		meta: pageMeta({
			title: article.title,
			description: article.summary,
			path,
			origin,
			noindex: searching,
			ogType: "article",
			publishedAt: article.publishedOn,
			modifiedAt: article.updatedAt,
		}),
		graph: jsonLdGraph(
			organizationJsonLd(origin),
			webSiteJsonLd(origin),
			webPageJsonLd({
				origin,
				path,
				name: article.title,
				description: article.summary,
				dateModified: article.updatedAt,
				breadcrumb: true,
			}),
			techArticleJsonLd({
				origin,
				path,
				headline: article.title,
				description: article.summary,
				datePublished: article.publishedOn,
				dateModified: article.updatedAt,
				section: category.title,
				wordCount: wordCount(docText(article)),
			}),
			breadcrumbListJsonLd(origin, articleCrumbs(article, category)),
		),
	};
}
