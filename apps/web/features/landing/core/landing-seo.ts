/**
 * landing-seo — the head facts and the structured data of `/` (`flows/LANDING.md` §4.0): the title,
 * the meta description and the social-card pair, and the schema.org graph — the organisation, the
 * website with its `SearchAction` into Explore, and the FAQPage, whose questions and answers are the
 * visible FAQ's own strings (`core/faq.ts`), so the two can never disagree.
 *
 * Pure (no islands, no DOM), so the page controller, the thin route and the page's render test share
 * it. Built on the marketing pages' builders (`@features/marketing/core/seo.ts`).
 */
import {
	absoluteUrl,
	faqPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	type JsonLdNode,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import type { FaqEntry } from "@features/landing/core/faq.ts";

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

/** The script node the landing's graph is emitted in. */
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
 * The landing's schema.org graph: the organisation; the website with a `SearchAction` into
 * Explore's free-text search (`/explore?q=`); and the FAQPage of the questions section, its every
 * question and answer the visible text word for word ("escrow" with it, Decision #283 (C)).
 *
 * @param origin The site's public origin, for the graph's absolute ids and URLs.
 * @param faq The questions exactly as the page prints them (`faqEntries`).
 */
export function landingGraph(origin: string, faq: readonly FaqEntry[]): JsonLdGraph {
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
	const questions = faq.length > 0
		? faqPageJsonLd({
			origin,
			path: "/",
			items: faq.map((entry) => ({ question: entry.question, answer: entry.answer })),
		})
		: null;
	return jsonLdGraph(organizationJsonLd(origin), site, questions);
}
// #endregion
