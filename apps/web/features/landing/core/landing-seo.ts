/**
 * landing-seo — the head facts and the structured data of the front page `/` (`flows/LANDING.md`
 * §4.0), which serves a guest the Explore Home (Decision #349): the title, the meta description and
 * the social-card pair, and the schema.org graph — the organisation and the website with its
 * `SearchAction` into Explore. The FAQPage moved with the questions to `/features`
 * (`features-seo.ts`).
 *
 * Pure (no islands, no DOM), so the thin route and its tests share it. Built on the marketing pages'
 * builders (`@features/marketing/core/seo.ts`).
 */
import {
	absoluteUrl,
	type JsonLdGraph,
	jsonLdGraph,
	type JsonLdNode,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";

// #region Copy
/**
 * The page's head copy (`flows/LANDING.md` §4.0). "Escrow" appears in the meta description only
 * (Decision #283 (C)); the Open Graph pair is the shorter social-card copy.
 */
export const LANDING_META = {
	title: "Projective — Hire a ready-made team with payment protection",
	description:
		"Hire a ready-made team and pay one stage at a time. Payment protection (escrow) holds your money safely, and the team is paid when you approve.",
	ogTitle: "Hire a ready-made team with payment protection",
	ogDescription:
		"Search freelancers, teams and services. Pay for each stage before it starts. The team is paid when you approve.",
} as const;

/** The script node the front page's graph is emitted in. */
export const LANDING_JSONLD_ID = "landing-jsonld";
// #endregion

// #region Head & structured data
/**
 * The `<head>` facts of `/`: the §4.0 title and meta description, the canonical `/`, and the
 * social-card title and description, which differ from the document's own.
 *
 * @param origin The site's public origin (`siteOrigin(ctx.url)`).
 */
export function landingPageMeta(origin: string): PageMeta {
	const meta = pageMeta({
		title: LANDING_META.title,
		description: LANDING_META.description,
		path: "/",
		origin,
	});
	return {
		...meta,
		og: { ...meta.og, title: LANDING_META.ogTitle, description: LANDING_META.ogDescription },
	};
}

/**
 * The front page's schema.org graph: the organisation, and the website with a `SearchAction` into
 * Explore's free-text search (`/explore?q=`).
 *
 * @param origin The site's public origin, for the graph's absolute ids and URLs.
 */
export function landingGraph(origin: string): JsonLdGraph {
	const site: JsonLdNode = {
		...webSiteJsonLd(origin),
		potentialAction: {
			"@type": "SearchAction",
			target: {
				"@type": "EntryPoint",
				urlTemplate: `${absoluteUrl(origin, "/explore")}?q={search_term_string}`,
			},
			"query-input": "required name=search_term_string",
		},
	};
	return jsonLdGraph(organizationJsonLd(origin), site);
}
// #endregion
