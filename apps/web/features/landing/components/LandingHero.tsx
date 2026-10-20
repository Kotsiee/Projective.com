import type { ComponentChildren, JSX } from "preact";
import { chipHref, HERO_SEARCH_COPY, heroCtas, type HeroViewer } from "../core/hero-search.ts";

// #region Copy
/**
 * The page's one h1 (`flows/LANDING.md` §4.1, headline option 1, recommended) as its two sentences,
 * each in two phrases. Each sentence sets on its own line at every width, and a sentence that does
 * not fit breaks between its phrases first ("Hire a / ready-made team. / Pay one stage / at a
 * time."), so no line ever carries a full stop mid-line. `[A1]` `[A2]`
 */
const HEADLINE = [
	["Hire a", "ready-made team."],
	["Pay one stage", "at a time."],
] as const;

/**
 * The hero's server-rendered text (`flows/LANDING.md` §4.1). The optional eyebrow is not set: the
 * h1 already says "ready-made team", and a reader would hear it twice (§2.8).
 */
export const HERO_COPY = {
	/** The h1's sentences, each as its phrases. */
	headline: HEADLINE,
	/** `[A3]` `[B3]` `[B2]` */
	lead:
		"Search for a team that's already formed. Work starts only once it's paid for. They're paid when you approve.",
} as const;

/** The h1's text exactly as a reader, a copy-paste and the accessibility tree get it. */
export const HERO_HEADLINE_TEXT: string = HEADLINE.map((sentence) => sentence.join(" ")).join(" ");
// #endregion

// #region Headline
/**
 * HeroHeadline — the page's one `<h1>`, set for the blur-fade reveal (`flows/LANDING.md` §3.6): each
 * sentence a `.lp-hero__line` (a block), each phrase a `.lp-hero__phrase` (an inline box, so a line
 * breaks between phrases before it breaks inside one), each word a `.lp-word` numbered in reading
 * order (`data-lp-w`, which the stylesheet turns into its stagger delay). The spaces are
 * real text nodes between the spans, so the heading's text is the one sentence pair
 * ({@link HERO_HEADLINE_TEXT}) — no `aria-label`, nothing hidden. The reveal is CSS alone and starts
 * at first paint; under either reduced-motion channel no animation is declared, so the words paint
 * final.
 */
function HeroHeadline(): JSX.Element {
	let word = 0;
	const sentences: ComponentChildren[] = [];
	HEADLINE.forEach((sentence, s) => {
		const phrases: ComponentChildren[] = [];
		sentence.forEach((phrase, p) => {
			const words: ComponentChildren[] = [];
			phrase.split(" ").forEach((text, w) => {
				if (w > 0) words.push(" ");
				words.push(<span key={word} class="lp-word" data-lp-w={word}>{text}</span>);
				word += 1;
			});
			if (p > 0) phrases.push(" ");
			phrases.push(<span key={`p${p}`} class="lp-hero__phrase">{words}</span>);
		});
		if (s > 0) sentences.push(" ");
		sentences.push(<span key={`s${s}`} class="lp-hero__line">{phrases}</span>);
	});
	return <h1 class="lp-display lp-display--hero lp-hero__title">{sentences}</h1>;
}
// #endregion

// #region Calls to action
/** Props for {@link HeroCtas}. */
export interface HeroCtasProps {
	viewer: HeroViewer;
}

/**
 * HeroCtas — the hero's two calls to action (`flows/LANDING.md` §4.1 table), reused by the final
 * call to action: "Hire a team" (tier 4, outlined) to Explore's teams, and the viewer's own second
 * action as a text link — "Offer your skills" (`/join?intent=freelancer` for a guest,
 * `/become-partner` for a signed-in client), "Find work" for a freelancer, nothing for a 13–17
 * account. Neither is filled: the search's submit is the region's one filled control (§B.8.2).
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

// #region Chips
/** Props for {@link HeroChips}. */
export interface HeroChipsProps {
	terms: readonly string[];
}

/**
 * HeroChips — the "Try:" line under the search (`[U3]`): each term a real link into Explore across
 * every category, set as underlined text on one wrapping meta line, separated by middots (§2.8: the
 * search field is the region's one interactive contour). The suggestions panel overlays it rather
 * than pushing it; with no terms it is not rendered at all (known on the server, so nothing shifts).
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
 * LandingHero — the landing's first section, `#hero` (`flows/LANDING.md` §2.1–§2.4, §2.8, §4.1): the
 * Precision hero, "the product is the picture". A positioned, isolated region the background fills
 * from beneath; above it one left-aligned column:
 *
 *   1. `.lp-hero__top`, three groups on one measure (`lp-hero.css`):
 *      - the copy block — the page's only `<h1>` ({@link HeroHeadline}, the LCP element) and the
 *        subline, server-rendered text;
 *      - the search group — the search bar (its field `.lp-search`, the hero's one full contour), as
 *        wide as the headline's longer sentence, and the "Try:" line;
 *      - the two calls to action — beside the field from 1280px, under the "Try:" line below it;
 *   2. the theatre slot, the section's last child: the real board in a straight-on window.
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
				<div class="lp-hero__top">
					<div class="lp-hero__copy">
						<HeroHeadline />
						<p class="lp-lead lp-hero__lead">{HERO_COPY.lead}</p>
					</div>
					<div class="lp-hero__find">
						{search}
						<HeroChips terms={chips} />
					</div>
					<HeroCtas viewer={viewer} />
				</div>
				{theatre && <div class="lp-hero__stage">{theatre}</div>}
			</div>
		</section>
	);
}
// #endregion
