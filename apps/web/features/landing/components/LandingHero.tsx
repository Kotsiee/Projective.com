import type { ComponentChildren, JSX } from "preact";
import { chipHref, HERO_SEARCH_COPY, heroCtas, type HeroViewer } from "../core/hero-search.ts";

// #region Copy
/** The hero's server-rendered text (`flows/LANDING.md` §4.1, headline option 1, recommended). */
export const HERO_COPY = {
	/** `[A1]` `[B1]` */
	eyebrow: "Ready-made teams · Payment protection",
	/** The page's one h1. `[A1]` `[A2]` */
	lines: ["Hire a ready-made team.", "Pay one stage at a time."],
	/** `[A3]` `[B3]` `[B2]` */
	lead:
		"Search for a team that's already formed. Work starts only once it's paid for. They're paid when you approve.",
} as const;
// #endregion

// #region Calls to action
/** Props for {@link HeroCtas}. */
export interface HeroCtasProps {
	viewer: HeroViewer;
}

/**
 * HeroCtas — the hero's two calls to action (`flows/LANDING.md` §4.1 table), reused by the final
 * call to action: "Hire a team" (tonal) to Explore's teams, and the viewer's own second action as a
 * text link — "Offer your skills" (`/join?intent=freelancer` for a guest, `/become-partner` for a
 * signed-in client), "Find work" for a freelancer, nothing for a 13–17 account. Neither is filled:
 * the search's submit is the region's one primary.
 */
export function HeroCtas({ viewer }: HeroCtasProps): JSX.Element {
	const { hire, offer } = heroCtas(viewer);
	return (
		<div class="lp-hero__ctas">
			<a class="lp-btn lp-btn--tonal lp-hero__cta" href={hire.href}>{hire.label}</a>
			{offer && <a class="lp-hero__link" href={offer.href}>{offer.label}</a>}
		</div>
	);
}
// #endregion

// #region Chips
/** Props for {@link HeroChips}. */
export interface HeroChipsProps {
	terms: readonly string[];
}

/**
 * HeroChips — the "Try:" row under the search (`[U3]`): each term a real link into Explore across
 * every category. The row's height is reserved, so the suggestions panel overlays it rather than
 * pushing it; with no terms it is not rendered at all (known on the server, so nothing shifts).
 */
export function HeroChips({ terms }: HeroChipsProps): JSX.Element | null {
	if (terms.length === 0) return null;
	return (
		<nav class="lp-chips" aria-label={HERO_SEARCH_COPY.chipsNav}>
			<p class="lp-chips__label" aria-hidden="true">{HERO_SEARCH_COPY.chipsLabel}</p>
			<ul class="lp-chips__list">
				{terms.map((term) => (
					<li key={term} class="lp-chips__item">
						<a class="lp-chip" href={chipHref(term)}>{term}</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
// #endregion

// #region Hero
/** Props for {@link LandingHero}. */
export interface LandingHeroProps {
	/** The hero's background layer (`LandingBackground`), painted beneath everything else. */
	background?: ComponentChildren;
	/** The search (`HeroSearch` island, which renders `HeroSearchForm`). */
	search: ComponentChildren;
	/** The "Try:" terms, server-derived (`heroChips`). */
	chips: readonly string[];
	/** Who is looking: picks the second call to action. */
	viewer: HeroViewer;
	/** The product theatre (`HeroTheatre`), under the calls to action. */
	theatre?: ComponentChildren;
}

/**
 * LandingHero — the landing's first section, `#hero` (`flows/LANDING.md` §2.1–§2.4, §4.1). A
 * positioned, isolated region the background fills from beneath; above it one centred column:
 *
 *   1. the copy block (`data-lp-quiet="copy"`, the box the constellation keeps quiet behind) — the
 *      eyebrow, the page's only `<h1>` (the LCP element at every width) and the subline, all
 *      server-rendered text;
 *   2. the search group — the search bar (its field is `.lp-search`, the halo box the background
 *      keeps clear) and the "Try:" chips;
 *   3. the two calls to action;
 *   4. the theatre slot.
 *
 * A server component: the islands it shows arrive as slots from the page controller, so it renders
 * under `deno test` and stays the one place the hero's order is written.
 */
export function LandingHero(
	{ background, search, chips, viewer, theatre }: LandingHeroProps,
): JSX.Element {
	return (
		<section id="hero" class="lp-hero">
			{background}
			<div class="lp-hero__inner">
				<div class="lp-hero__copy" data-lp-quiet="copy">
					<p class="lp-eyebrow">{HERO_COPY.eyebrow}</p>
					<h1 class="lp-display lp-display--hero lp-hero__title">
						<span class="lp-hero__line">{HERO_COPY.lines[0]}</span>{" "}
						<span class="lp-hero__line">{HERO_COPY.lines[1]}</span>
					</h1>
					<p class="lp-lead lp-hero__lead">{HERO_COPY.lead}</p>
				</div>
				<div class="lp-hero__find">
					{search}
					<HeroChips terms={chips} />
				</div>
				<HeroCtas viewer={viewer} />
				{theatre && <div class="lp-hero__stage">{theatre}</div>}
			</div>
		</section>
	);
}
// #endregion
