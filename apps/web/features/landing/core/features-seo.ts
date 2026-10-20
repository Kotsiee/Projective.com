/**
 * features-seo — the head facts and the structured data of `/features` (`flows/LANDING.md` §4.12,
 * §2.6 note 2; work order L5): the §4.12 meta title and description, the canonical `/features` (no
 * `?section=`), and the schema.org graph — the organisation and the website every node points at,
 * the WebPage, and the ItemList of the features the page prints, each entry's name and description
 * the row's own visible words (`features-catalogue.ts`), so the two can never disagree.
 *
 * Pure (no islands, no DOM): the thin route, the page view and its render test share it. Built on the
 * public pages' builders (`@features/marketing/core/seo.ts`).
 */
import {
	itemListId,
	itemListJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	webPageJsonLd,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import {
	type FeatureEntry,
	FEATURES_COPY,
	FEATURES_META,
	FEATURES_PATH,
} from "@features/landing/core/features-catalogue.ts";

/** The script node the page's graph is emitted in. */
export const FEATURES_JSONLD_ID = "features-jsonld";

/**
 * The `<head>` facts of `/features`: §4.12's title and description, and its canonical path — the
 * `?section=` a link may carry names a place on the one page, never another page. The document
 * title is §4.12's word for word: it already leads with the brand ("Projective features — …"), so it
 * takes no " · Projective" suffix (`documentTitle` recognises only a "Projective —" lead).
 *
 * @param origin The site's public origin (`siteOrigin(ctx.url)`).
 */
export function featuresPageMeta(origin: string): PageMeta {
	const meta = pageMeta({
		title: FEATURES_META.title,
		description: FEATURES_META.description,
		path: FEATURES_PATH,
		origin,
	});
	return { ...meta, title: FEATURES_META.title };
}

/**
 * The page's schema.org graph: the WebPage (named by its h1, described by its meta description)
 * whose main entity is the ItemList of the rows it prints, in page order — each the row's h3 as its
 * name, its description word for word, and its anchor on the page — beside the website and the
 * organisation the page node points at.
 *
 * @param origin The site's public origin, for the graph's absolute ids and URLs.
 * @param rows The rows exactly as the page prints them (`printedFeatures()`).
 */
export function featuresGraph(origin: string, rows: readonly FeatureEntry[]): JsonLdGraph {
	const page = {
		...webPageJsonLd({
			origin,
			path: FEATURES_PATH,
			name: FEATURES_COPY.title,
			description: FEATURES_META.description,
		}),
		mainEntity: { "@id": itemListId(origin, FEATURES_PATH) },
	};
	const list = itemListJsonLd({
		origin,
		path: FEATURES_PATH,
		name: FEATURES_COPY.title,
		items: rows.map((row) => ({
			name: row.title,
			description: row.description,
			url: `${FEATURES_PATH}#${row.id}`,
		})),
	});
	return jsonLdGraph(page, list, webSiteJsonLd(origin), organizationJsonLd(origin));
}
