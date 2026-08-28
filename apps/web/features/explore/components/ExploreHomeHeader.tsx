import type { JSX } from "preact";
import SearchBar from "@features/marketing/islands/SearchBar.island.tsx";
import { HERO_QUICK_FILTERS } from "../core/home-model.ts";

/**
 * ExploreHomeHeader — the COMPACT discovery hero.
 *
 * One headline, the shared search bar, and a row of quick-filter pills. That is the whole thing.
 *
 * It used to be a full illustrated band: an uppercase kicker, a two-line display headline, a
 * supporting lede, and the search — 591px of a 720px viewport, measured, which left the categories
 * and the recommendations entirely below the fold on a laptop. Everything that survived the cut is
 * something the reader acts on; everything cut was something they read once and never again.
 *
 * The deep-primary band and its line-art backdrop stay, because they are the surface's identity and
 * they cost no height — the art is absolutely positioned behind the content. What changed is the
 * vertical padding and the number of text blocks stacked inside it.
 *
 * The quick filters are INTENT shortcuts, deliberately not a second copy of the category chips
 * directly below: the chips answer "what kind of thing", these answer "what am I here to do".
 */
export function ExploreHomeHeader(): JSX.Element {
	return (
		<header class="ex-hero ex-hero--compact">
			<HeaderArt />
			<div class="ex-hero__inner">
				<h1 class="ex-hero__title">Find the people who make it real.</h1>
				<div class="ex-hero__search">
					<SearchBar variant="hero" />
				</div>
				<nav class="ex-hero__quick" aria-label="Popular searches">
					{HERO_QUICK_FILTERS.map((f) => (
						<a class="ex-hero__quicklink" href={f.href} key={f.label}>{f.label}</a>
					))}
				</nav>
			</div>
		</header>
	);
}

/**
 * The soft, adaptive on-primary backdrop — mirrors the auth side-panel language: a blurred floating
 * aura, a layered orbital frame (a dashed slow-spin ring, a counter-rotating inner ring, concentric
 * guides + discovery nodes), and a faint left-side constellation motif. Drawn entirely in
 * `var(--on-primary)` so it recolours with the theme (token-only).
 *
 * The viewBox is now 1200×260 rather than 1200×480. `preserveAspectRatio="xMidYMid slice"` crops to
 * fill, so a tall artboard inside a short band would have scaled the orbital frame up and pushed most
 * of it out of view — the motif would still be there and none of it would read.
 */
function HeaderArt(): JSX.Element {
	return (
		<svg
			class="ex-hero__art"
			viewBox="0 0 1200 260"
			role="img"
			aria-hidden="true"
			preserveAspectRatio="xMidYMid slice"
		>
			<defs>
				<filter id="ex-hero-soft" x="-40%" y="-40%" width="180%" height="180%">
					<feGaussianBlur stdDeviation="46" />
				</filter>
			</defs>

			{/* Blurred floating aura. */}
			<g filter="url(#ex-hero-soft)" opacity="0.22">
				<circle cx="985" cy="60" r="110" fill="var(--on-primary)" />
				<circle cx="1130" cy="215" r="130" fill="var(--on-primary)" />
				<circle cx="130" cy="230" r="110" fill="var(--on-primary)" />
			</g>

			{/* Layered orbital frame + discovery nodes. */}
			<g fill="none" stroke="var(--on-primary)">
				<circle
					class="ex-hero__orbit"
					cx="1010"
					cy="130"
					r="150"
					stroke-width="1.5"
					stroke-dasharray="2 12"
					stroke-linecap="round"
					opacity="0.34"
				/>
				<circle
					class="ex-hero__orbit ex-hero__orbit--rev"
					cx="1010"
					cy="130"
					r="108"
					stroke-width="1"
					stroke-dasharray="1 16"
					stroke-linecap="round"
					opacity="0.5"
				/>
				<circle cx="1010" cy="130" r="70" stroke-width="1" opacity="0.26" />
				<circle cx="1010" cy="-20" r="4" fill="var(--on-primary)" stroke="none" opacity="0.6" />
				<circle cx="1160" cy="130" r="3" fill="var(--on-primary)" stroke="none" opacity="0.5" />
				<circle cx="902" cy="66" r="2.5" fill="var(--on-primary)" stroke="none" opacity="0.45" />
			</g>

			{/* Faint left-side constellation — the discovery motif. */}
			<g
				stroke="var(--on-primary)"
				stroke-width="1"
				opacity="0.16"
				fill="none"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M108 64 L188 112 L154 196 M188 112 L280 88" />
				<circle cx="108" cy="64" r="3" fill="var(--on-primary)" stroke="none" />
				<circle cx="188" cy="112" r="3" fill="var(--on-primary)" stroke="none" />
				<circle cx="154" cy="196" r="3" fill="var(--on-primary)" stroke="none" />
				<circle cx="280" cy="88" r="3" fill="var(--on-primary)" stroke="none" />
			</g>
		</svg>
	);
}
