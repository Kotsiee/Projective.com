import type { ComponentChildren, JSX } from "preact";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { FeatureIndex } from "@features/landing/components/FeatureIndex.tsx";
import { PaymentProtection } from "@features/landing/components/PaymentProtection.tsx";
import { Faq } from "@features/landing/components/Faq.tsx";
import { FinalCta } from "@features/landing/components/FinalCta.tsx";
import { faqEntries } from "@features/landing/core/faq.ts";
import { protectionTermsHref } from "@features/landing/core/protection-terms.ts";
import type { HeroViewer } from "@features/landing/core/hero-search.ts";
import {
	type FeatureChapterId,
	FEATURES_COPY,
	printedFeatures,
} from "@features/landing/core/features-catalogue.ts";
import { FEATURES_JSONLD_ID, featuresGraph } from "@features/landing/core/features-seo.ts";

// #region Props
/** The h1's id. */
export const FEATURES_TITLE_ID = "features-title";

/**
 * The page's island-bearing parts, built by the page controller and slotted in here, so the whole
 * composition renders under `deno test` (an island's stylesheet cannot load there).
 */
export interface FeaturesIslands {
	/**
	 * The "Try it" dialog (`FeatureDemoDialog`): it renders nothing until a "Try it" is pressed, and
	 * carries the page's stylesheets.
	 */
	dialog: ComponentChildren;
	/** Each chapter's picture, a real-component still of a demo; a chapter with none prints bare. */
	stills: Partial<Record<FeatureChapterId, ComponentChildren>>;
	/** The demo stage (`DemoStage`), opened on the tab `?demo=` names (`#demo`). */
	demo: ComponentChildren;
	/** Pricing with its calculator (`Pricing`). */
	pricing: ComponentChildren;
	/** The final call to action's search (`HeroSearch`, `idSuffix` `-final`): the page's only one. */
	finalSearch: ComponentChildren;
}

/** Props for {@link FeaturesPageView}. */
export interface FeaturesPageViewProps {
	/** The site's public origin, for the structured data's absolute ids and URLs. */
	origin: string;
	/** Who is looking: picks the final call to action's second action, as on `/`. */
	viewer: HeroViewer;
	/** The chapter `?section=` asked for, or `null`. */
	section: FeatureChapterId | null;
	/**
	 * The platform fee in basis points, or `null` when the read failed — then Payment protection and
	 * the questions drop every fee clause (`flows/LANDING.md` §4).
	 */
	feeBp: number | null;
	islands: FeaturesIslands;
}
// #endregion

// #region Page
/**
 * FeaturesPageView — the whole of `/features` (`flows/LANDING.md` §2.5, §2.6, §4.12), rendered inside
 * LandingShell's `<main>`. First the structured data (the WebPage and the ItemList of the rows printed
 * below, one list for both), then:
 *
 *   1. the page head: the section-header "Features", the page's one h1 and its subline `[P9]`, on the
 *      solid canvas (no grid, Decision #349);
 *   2. the chapter index ({@link FeatureIndex}): the chapter navigation, then the five chapters, each a
 *      landmark labelled by its h2;
 *   3. the deep dives that left the front page when `/` became the Explore Home (Decision #349): the
 *      demo stage (`#demo`), Payment protection, Pricing and the questions (`#faq`, its FAQPage in the
 *      graph);
 *   4. the final call to action (`#get-started`), with the page's only search.
 *
 * The "Try it" dialog mounts last: it shows nothing until a "Try it" is pressed.
 */
export function FeaturesPageView(
	{ origin, viewer, section, feeBp, islands }: FeaturesPageViewProps,
): JSX.Element {
	const faq = faqEntries(feeBp);
	return (
		<>
			<JsonLd graph={featuresGraph(origin, printedFeatures(), faq)} id={FEATURES_JSONLD_ID} />
			<div class="lp-features">
				<header class="lp-features__head">
					<div class="lp-features__head-inner">
						<p class="lp-eyebrow">{FEATURES_COPY.eyebrow}</p>
						<h1 id={FEATURES_TITLE_ID} class="lp-display lp-display--hero lp-features__title">
							{FEATURES_COPY.title}
						</h1>
						<p class="lp-lead lp-features__lead">{FEATURES_COPY.lead}</p>
					</div>
				</header>
				<FeatureIndex target={section} stills={islands.stills} />
			</div>
			{islands.demo}
			<PaymentProtection termsHref={protectionTermsHref()} feeBp={feeBp} />
			{islands.pricing}
			<Faq feeBp={feeBp} entries={faq} />
			<FinalCta search={islands.finalSearch} viewer={viewer} />
			{islands.dialog}
		</>
	);
}
// #endregion
