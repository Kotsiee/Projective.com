import type { ComponentChildren, JSX } from "preact";
import { heroCtas, type HeroViewer } from "@features/landing/core/hero-search.ts";

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

// #region Calls to action
/** Props for {@link HeroCtas}. */
export interface HeroCtasProps {
	viewer: HeroViewer;
}

/**
 * HeroCtas — the closing calls to action (`flows/LANDING.md` §4.1 table): "Hire a team" (tier 4,
 * outlined) to Explore's teams, and the viewer's own second action as a text link — "Offer your
 * skills" (`/join?intent=freelancer` for a guest, `/become-partner` for a signed-in client), "Find
 * work" for a freelancer, nothing for a 13–17 account. Neither is filled: the search's submit is the
 * region's one filled control (§B.8.2).
 */
export function HeroCtas({ viewer }: HeroCtasProps): JSX.Element {
	const { hire, offer } = heroCtas(viewer);
	return (
		<div class="lp-hero__ctas">
			<a class="lp-btn lp-btn--outlined lp-hero__cta" href={hire.href}>{hire.label}</a>
			{offer && <a class="lp-hero__link" href={offer.href}>{offer.label}</a>}
		</div>
	);
}
// #endregion

// #region Component
/** Props for {@link FinalCta}. */
export interface FinalCtaProps {
	/**
	 * The shared hero `SearchBar` (Decision #358): the same bar as `/`, `/explore` and
	 * `/explore?q=`, holding the `/` shortcut as the page's only search.
	 */
	search: ComponentChildren;
	/** Who is looking: picks the second call to action ({@link HeroCtas}). */
	viewer: HeroViewer;
}

/**
 * FinalCta — the page's closing call to action, `#get-started` (`flows/LANDING.md` §2.1 note 24,
 * §2.2 note 22, §2.3 note 22, §4.11): the h2 the section is labelled by and its subline, the search
 * into Explore again, then the calls to action ({@link HeroCtas}: "Hire a team", tier 4 outlined,
 * and the viewer's own text link). One centred column on the solid canvas — no grid (Decision #349).
 * The search's submit is the region's one fill; nothing here moves money, so nothing is amber
 * (Decision #288 (E)).
 *
 * A server component: its islands arrive as slots from the page controller, so it renders under
 * `deno test`.
 */
export function FinalCta({ search, viewer }: FinalCtaProps): JSX.Element {
	return (
		<section id={FINAL_SECTION_ID} class="lp-final" aria-labelledby={FINAL_TITLE_ID}>
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
