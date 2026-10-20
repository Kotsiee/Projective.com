import type { ComponentChildren, JSX } from "preact";
import type { PublicMetrics } from "@projective/types/marketing";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { LandingHero } from "@features/landing/components/LandingHero.tsx";
import { WhyDifferent } from "@features/landing/components/WhyDifferent.tsx";
import { PaymentProtection } from "@features/landing/components/PaymentProtection.tsx";
import { LiveNumbers } from "@features/landing/components/LiveNumbers.tsx";
import { ForTeams } from "@features/landing/components/ForTeams.tsx";
import { Faq } from "@features/landing/components/Faq.tsx";
import { FinalCta } from "@features/landing/components/FinalCta.tsx";
import type { HeroViewer } from "@features/landing/core/hero-search.ts";
import { faqEntries } from "@features/landing/core/faq.ts";
import { LANDING_JSONLD_ID, landingGraph } from "@features/landing/core/landing-seo.ts";
import { protectionTermsHref } from "@features/landing/core/protection-terms.ts";

// #region Props
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
 * The page's island-bearing parts, built by the page controller and slotted in here, so the whole
 * composition renders under `deno test` (an island's stylesheet cannot load there).
 */
export interface LandingIslands {
	/** The hero's background (`LandingBackground`). */
	heroBackground: ComponentChildren;
	/** The hero's search (`HeroSearch`: owns `/` and the typewriter). */
	heroSearch: ComponentChildren;
	/** The hero's product theatre (`HeroTheatre`). */
	theatre: ComponentChildren;
	/** How it works (`MoneyFlowStage`, `#how-it-works`). */
	howItWorks: ComponentChildren;
	/** The demo stage (`DemoStage`, `#demo`). */
	demo: ComponentChildren;
	/**
	 * Ways to work and its live rails (`WaysToWork`, `#ways-to-work`), handed the server's slice of
	 * the marketplace (`sliceRails`); its rails' scroll buttons are an island.
	 */
	waysToWork: ComponentChildren;
	/** Pricing and its calculator (`Pricing`, `#pricing`); the calculator is an island. */
	pricing: ComponentChildren;
	/** The final call to action's background (`LandingBackground variant="final"`). */
	finalBackground: ComponentChildren;
	/** The final call to action's quiet second search (`HeroSearch`, `idSuffix` `-final`). */
	finalSearch: ComponentChildren;
}

/** Props for {@link LandingPageView}. */
export interface LandingPageViewProps {
	/** The site's public origin, for the structured data's absolute ids and URLs. */
	origin: string;
	/** The hero search's server-derived data. */
	hero: LandingHeroData;
	/**
	 * The live figures (`PublicMetricsService.get()`), or `null` when the read failed — then the
	 * numbers section is omitted and every fee clause on the page drops (`flows/LANDING.md` §4).
	 */
	metrics: PublicMetrics | null;
	islands: LandingIslands;
}
// #endregion

// #region Page
/**
 * The platform fee in basis points the page prints every fee figure from (`platform_fee_bp` through
 * `PublicMetricsService`), or `null` when the metrics are unavailable. Never hard-coded.
 */
export function landingFeeBp(metrics: PublicMetrics | null): number | null {
	return metrics?.platformFeeBp ?? null;
}

/**
 * LandingPageView — the whole of `/` in the `flows/LANDING.md` §2 order, rendered inside
 * LandingShell's `<main>`. First the structured data (the organisation, the website's search, and
 * the FAQPage of the questions printed below — one list for both), then:
 *
 *   1. the hero (`#hero`, the page's one h1);
 *   2. Why it's different (`#why-different`);
 *   3. How it works (`#how-it-works`, the scroll-linked money flow);
 *   4. the demo stage (`#demo`);
 *   5. Ways to work and its live rails (`#ways-to-work`);
 *   6. Payment protection (`#payment-protection`, the first warm band), linking the legal hub's
 *      payment protection terms only once a lawyer has reviewed them (`protectionTermsHref`);
 *   7. the numbers so far (`#numbers`, the same band), omitted with no live figure to show;
 *   8. For freelancers and teams (`#for-freelancers`), its calls to action per viewer;
 *   9. Pricing (`#pricing`, the second warm band);
 *  10. the questions (`#faq`);
 *  11. the final call to action (`#get-started`), its calls to action per viewer.
 *
 * Every section after the hero is a landmark labelled by its one h2. Every fee figure reads one
 * value, {@link landingFeeBp}; island-bearing parts arrive as {@link LandingIslands}.
 */
export function LandingPageView(
	{ origin, hero, metrics, islands }: LandingPageViewProps,
): JSX.Element {
	const feeBp = landingFeeBp(metrics);
	const faq = faqEntries(feeBp);
	return (
		<>
			<JsonLd graph={landingGraph(origin, faq)} id={LANDING_JSONLD_ID} />
			<LandingHero
				background={islands.heroBackground}
				search={islands.heroSearch}
				chips={hero.chips}
				viewer={hero.viewer}
				theatre={islands.theatre}
			/>
			<WhyDifferent />
			{islands.howItWorks}
			{islands.demo}
			{islands.waysToWork}
			<PaymentProtection termsHref={protectionTermsHref()} feeBp={feeBp} />
			<LiveNumbers metrics={metrics} />
			<ForTeams viewer={hero.viewer} feeBp={feeBp} />
			{islands.pricing}
			<Faq feeBp={feeBp} entries={faq} />
			<FinalCta
				background={islands.finalBackground}
				search={islands.finalSearch}
				viewer={hero.viewer}
			/>
		</>
	);
}
// #endregion
