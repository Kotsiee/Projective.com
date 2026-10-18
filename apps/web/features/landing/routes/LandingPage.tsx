import type { JSX } from "preact";
import type { LandingPayload } from "@projective/types/explore";
import LandingBackground from "@features/landing/islands/LandingBackground.island.tsx";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import {
	absoluteUrl,
	jsonLdGraph,
	type JsonLdNode,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";

// #region Copy
/** The hero's server-rendered text (`flows/LANDING.md` §4.1, headline option 1). */
const HERO = {
	eyebrow: "Ready-made teams · Payment protection",
	lines: ["Hire a ready-made team.", "Pay one stage at a time."],
	lead:
		"Search for a team that's already formed. Work starts only once it's paid for. They're paid when you approve.",
} as const;

/**
 * The page's head copy (`flows/LANDING.md` §4.0). "Escrow" appears in the meta description only
 * (Decision #283 (C)); the Open Graph pair is the shorter social-card copy.
 */
const META = {
	title: "Projective — Hire a ready-made team with payment protection",
	description:
		"Hire a ready-made team and pay one stage at a time. Payment protection (escrow) holds your money safely, and the team is paid when you approve.",
	ogTitle: "Hire a ready-made team with payment protection",
	ogDescription:
		"Search freelancers, teams and services. Pay for each stage before it starts. The team is paid when you approve.",
} as const;
// #endregion

// #region Head & structured data
/**
 * The `<head>` facts of `/`: the §4.0 title and meta description, the canonical `/`, and the
 * social-card title and description, which differ from the document's own.
 *
 * @param origin The site's public origin (`siteOrigin(ctx.url)`).
 */
export function landingPageMeta(origin: string): PageMeta {
	const meta = pageMeta({ title: META.title, description: META.description, path: "/", origin });
	return { ...meta, og: { ...meta.og, title: META.ogTitle, description: META.ogDescription } };
}

/**
 * The landing's schema.org graph: the organisation, and the website with a `SearchAction` into
 * Explore's free-text search (`/explore?q=`). The FAQPage joins with the questions section, whose
 * visible text it must repeat word for word.
 */
function landingGraph(origin: string) {
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

// #region Page
/** Props for {@link LandingPage}. */
export interface LandingPageProps {
	/**
	 * The live marketplace (`ExploreBackendService.landing()`), or `null` when the read failed — the
	 * page's story never depends on it. Server-only: a section that shows any of it slices what it
	 * renders here, and an island receives only that slice, never the whole feed.
	 */
	landing: LandingPayload | null;
	/** The site's public origin, for the structured data's absolute ids and URLs. */
	origin: string;
}

/**
 * LandingPage — the page controller of `/` (`flows/LANDING.md`), rendered inside LandingShell's
 * `<main>`.
 *
 * The hero (`#hero`) is a positioned, isolated region: {@link LandingBackground} fills it from
 * beneath with the static paint first and the WebGL upgrade only where allowed, and the copy column
 * sits above it — the eyebrow, the page's only `<h1>` (the LCP element at every width) and the
 * subline, all server-rendered text that needs no JavaScript. The copy block is marked
 * `data-lp-quiet="copy"`, the box the constellation keeps quiet behind. `.lp-hero__inner` is a
 * centred column whose first child is the copy block, so the hero's controls stack beneath it.
 */
export function LandingPage({ origin }: LandingPageProps): JSX.Element {
	return (
		<>
			<JsonLd graph={landingGraph(origin)} id="landing-jsonld" />
			<section id="hero" class="lp-hero">
				<LandingBackground variant="hero" />
				<div class="lp-hero__inner">
					<div class="lp-hero__copy" data-lp-quiet="copy">
						<p class="lp-eyebrow">{HERO.eyebrow}</p>
						<h1 class="lp-display lp-display--hero lp-hero__title">
							<span class="lp-hero__line">{HERO.lines[0]}</span>{" "}
							<span class="lp-hero__line">{HERO.lines[1]}</span>
						</h1>
						<p class="lp-lead lp-hero__lead">{HERO.lead}</p>
					</div>
				</div>
			</section>
		</>
	);
}
// #endregion
