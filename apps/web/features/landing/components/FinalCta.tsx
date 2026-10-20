import type { ComponentChildren, JSX } from "preact";
import type { HeroViewer } from "@features/landing/core/hero-search.ts";
import { HeroCtas } from "@features/landing/components/LandingHero.tsx";

// #region Copy
/** The section's anchor (`flows/LANDING.md` §4.11). */
export const FINAL_SECTION_ID = "get-started";

/** The h2's id: the section is labelled by its one h2. */
export const FINAL_TITLE_ID = "get-started-title";

/** The id suffix of the section's search, so its ids never collide with the hero's (`heroSearchIds`). */
export const FINAL_SEARCH_SUFFIX = "-final";

/** The section's words (§4.11). */
export const FINAL_COPY = {
	title: "Find your team.",
	/** `[U1]` `[A2]` `[B1]` */
	lead: "Search for the help you need. Pay safely, one stage at a time.",
} as const;
// #endregion

// #region Component
/** Props for {@link FinalCta}. */
export interface FinalCtaProps {
	/**
	 * The second `HeroSearch` instance (`idSuffix` {@link FINAL_SEARCH_SUFFIX}): the static
	 * placeholder, no typewriter, no `/` hint and no shortcut — the hero's instance owns the key
	 * (Decision #282 (A)) — and no "Try:" line (§2.1 note 24).
	 */
	search: ComponentChildren;
	/** Who is looking: picks the second call to action, exactly as in the hero. */
	viewer: HeroViewer;
	/** The section's background layer (`LandingBackground variant="final"`), painted beneath it. */
	background?: ComponentChildren;
}

/**
 * FinalCta — the page's closing call to action, `#get-started` (`flows/LANDING.md` §2.1 note 24,
 * §2.2 note 22, §2.3 note 22, §4.11): the h2 the section is labelled by and its subline, the search
 * into Explore again, then the hero's calls to action ({@link HeroCtas}: "Hire a team", tier 4
 * outlined, and the viewer's own text link). One centred column over the B7 grid, whose spotlight
 * follows a fine pointer — the only motion in view (§2.7). The search's submit is the region's one
 * fill; nothing here moves money, so nothing is amber (Decision #288 (E)).
 *
 * A server component: its islands arrive as slots from the page controller, so it renders under
 * `deno test`, as `LandingHero` does.
 */
export function FinalCta({ search, viewer, background }: FinalCtaProps): JSX.Element {
	return (
		<section id={FINAL_SECTION_ID} class="lp-final" aria-labelledby={FINAL_TITLE_ID}>
			{background}
			<div class="lp-final__inner">
				<h2 id={FINAL_TITLE_ID} class="lp-display lp-display--section lp-final__title">
					{FINAL_COPY.title}
				</h2>
				<p class="lp-lead lp-final__lead">{FINAL_COPY.lead}</p>
				<div class="lp-final__search">{search}</div>
				<div class="lp-final__ctas">
					<HeroCtas viewer={viewer} />
				</div>
			</div>
		</section>
	);
}
// #endregion
