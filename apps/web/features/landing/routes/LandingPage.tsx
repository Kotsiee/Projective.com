import type { JSX } from "preact";
import type { LandingPayload } from "@projective/types/explore";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import LandingBackground from "@features/landing/islands/LandingBackground.island.tsx";
import HeroSearch from "@features/landing/islands/HeroSearch.island.tsx";
import HeroTheatre from "@features/landing/components/HeroTheatre.tsx";
import MoneyFlowStage from "@features/landing/components/MoneyFlowStage.tsx";
import DemoStage from "@features/landing/components/DemoStage.tsx";
import { WaysToWork } from "@features/landing/components/WaysToWork.tsx";
import { Pricing } from "@features/landing/components/Pricing.tsx";
import { FINAL_SEARCH_SUFFIX, FINAL_TITLE_ID } from "@features/landing/components/FinalCta.tsx";
import { HERO_SEARCH_COPY } from "@features/landing/core/hero-search.ts";
import {
	landingFeeBp,
	LandingPageView,
	type LandingPageViewProps,
} from "@features/landing/components/LandingPageView.tsx";
import type { DemoId } from "@features/landing/core/demos/demo-contract.ts";
import { sliceRails } from "@features/landing/core/rails.ts";

export type { LandingHeroData } from "@features/landing/components/LandingPageView.tsx";
export { landingPageMeta } from "@features/landing/core/landing-seo.ts";

// #region Page
/** Props for {@link LandingPage}. */
export interface LandingPageProps extends Omit<LandingPageViewProps, "islands"> {
	/**
	 * The live marketplace (`ExploreBackendService.landing()`), or `null` when the read failed — the
	 * page's story never depends on it. Server-only: sliced here (`sliceRails`) into the few cards
	 * the rails print, so no island ever receives the feed.
	 */
	landing: LandingPayload | null;
	/** The demo stage's open tab, from `?demo=` (default `board`). */
	demo: DemoId;
}

/**
 * LandingPage — the page controller of `/` (`flows/LANDING.md`), rendered inside LandingShell's
 * `<main>`. It builds the page's island-bearing parts and hands them to {@link LandingPageView},
 * which writes the order:
 *
 *   - the hero's background ({@link LandingBackground}), the {@link HeroSearch} instance that owns
 *     `/` and the typewriter (`idSuffix` empty, its landmark named "Search Projective"), and the
 *     {@link HeroTheatre}, handed `demo` (its "Try it yourself" link, since the page renders the
 *     demo stage);
 *   - How it works ({@link MoneyFlowStage}) and the demo stage ({@link DemoStage}), each handed the
 *     server's fee; Ways to work ({@link WaysToWork}) with the rails sliced from the marketplace;
 *     Pricing ({@link Pricing}) with its calculator;
 *   - the final call to action's background and its quiet second search — the same terms and
 *     trending rows, `idSuffix` `-final`, its landmark named by the section's h2 ("Find your
 *     team."), no typewriter and no `/` shortcut, so exactly one instance
 *     owns the key (Decision #282 (A)) and the hero's timeline never hears it (`hero-motion.ts`
 *     listens inside `#hero` only).
 */
export function LandingPage({ landing, demo, ...view }: LandingPageProps): JSX.Element {
	const { hero } = view;
	const feeBp = landingFeeBp(view.metrics);
	return (
		<LandingPageView
			{...view}
			islands={{
				heroBackground: <LandingBackground variant="hero" />,
				heroSearch: (
					<HeroSearch
						slashFocus
						typewriter
						terms={hero.terms}
						trending={hero.trending}
						avatarFallback={DEFAULT_AVATAR_URL}
						landmarkLabel={HERO_SEARCH_COPY.landmark}
					/>
				),
				theatre: <HeroTheatre demo />,
				howItWorks: <MoneyFlowStage feeBp={feeBp} />,
				demo: <DemoStage demo={demo} feeBp={feeBp} />,
				waysToWork: <WaysToWork rails={sliceRails(landing)} />,
				pricing: <Pricing feeBp={feeBp} />,
				finalBackground: <LandingBackground variant="final" />,
				finalSearch: (
					<HeroSearch
						idSuffix={FINAL_SEARCH_SUFFIX}
						slashFocus={false}
						typewriter={false}
						terms={hero.terms}
						trending={hero.trending}
						avatarFallback={DEFAULT_AVATAR_URL}
						landmarkLabelledBy={FINAL_TITLE_ID}
					/>
				),
			}}
		/>
	);
}
// #endregion
