import type { JSX } from "preact";
import type { LandingPayload } from "@projective/types/explore";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import LandingBackground from "@features/landing/islands/LandingBackground.island.tsx";
import HeroSearch from "@features/landing/islands/HeroSearch.island.tsx";
import { LandingHero } from "@features/landing/components/LandingHero.tsx";
import HeroTheatre from "@features/landing/components/HeroTheatre.tsx";
import type { HeroViewer } from "@features/landing/core/hero-search.ts";
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
	/** The hero search's server-derived data (`routes/(public)/index.tsx`). */
	hero: LandingHeroData;
}

/**
 * What the route reads for the hero search (`ExploreBackendService.landingHero`, with the viewer
 * facts), already sliced to what the page shows.
 */
export interface LandingHeroData {
	/** The typewriter's examples, each confirmed by a suggest hit (`landingHero`); may be empty. */
	terms: string[];
	/** The trending terms for every category: the empty field's Trending rows. */
	trending: string[];
	/** The "Try:" chips (`landingHero`); empty omits the row. */
	chips: string[];
	/** The few viewer facts the calls to action read (`heroViewerOf`). */
	viewer: HeroViewer;
}

/**
 * LandingPage — the page controller of `/` (`flows/LANDING.md`), rendered inside LandingShell's
 * `<main>`: the structured data, then the hero ({@link LandingHero}) with its islands slotted in —
 * {@link LandingBackground} beneath it, the {@link HeroSearch} instance that owns `/` and the
 * typewriter (`idSuffix` empty; the final call to action, L4, mounts a second, quiet one), and
 * the {@link HeroTheatre}, which shows no fee and so is not handed one, and is handed `demo` (its
 * "Try it yourself" link) only once the page renders the demo stage (L3).
 */
export function LandingPage({ origin, hero }: LandingPageProps): JSX.Element {
	return (
		<>
			<JsonLd graph={landingGraph(origin)} id="landing-jsonld" />
			<LandingHero
				background={<LandingBackground variant="hero" />}
				search={
					<HeroSearch
						slashFocus
						typewriter
						terms={hero.terms}
						trending={hero.trending}
						avatarFallback={DEFAULT_AVATAR_URL}
					/>
				}
				chips={hero.chips}
				viewer={hero.viewer}
				theatre={<HeroTheatre />}
			/>
		</>
	);
}
// #endregion
