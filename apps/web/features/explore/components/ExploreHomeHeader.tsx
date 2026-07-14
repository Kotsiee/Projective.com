import type { JSX } from "preact";
import SearchBar from "@features/marketing/islands/SearchBar.island.tsx";

/**
 * ExploreHomeHeader — the premium discovery header for the Explore Home. A deep-primary illustrative
 * band (mirroring the auth side-panel language): a large adaptive line-art backdrop, an expressive
 * two-tone heading, a supporting lede, and the ONE large shared search bar. This is the only place the
 * hero-scale search bar exists — the Search Results page defers to the global nav header search.
 */
export function ExploreHomeHeader(): JSX.Element {
	return (
		<header class="ex-hero">
			<HeaderArt />
			<div class="ex-hero__inner">
				<p class="ex-hero__kicker">Discover on Projective</p>
				<h1 class="ex-hero__title">
					<span class="ex-hero__title-lead">Find the people</span>{" "}
					<span class="ex-hero__title-strong">who make it real.</span>
				</h1>
				<p class="ex-hero__lede">
					Freelancers, teams, services, projects, and ready-made goods — escrow-backed, and all in
					one place.
				</p>
				<div class="ex-hero__search">
					<SearchBar variant="hero" />
				</div>
			</div>
		</header>
	);
}

/**
 * The soft, adaptive on-primary backdrop — mirrors the auth side-panel language: a blurred floating
 * aura, a layered orbital frame (a dashed slow-spin ring, a counter-rotating inner ring, concentric
 * guides + discovery nodes), and a faint left-side constellation motif. Drawn entirely in
 * `var(--on-primary)` so it recolours with the theme (token-only).
 */
function HeaderArt(): JSX.Element {
	return (
		<svg
			class="ex-hero__art"
			viewBox="0 0 1200 480"
			role="img"
			aria-hidden="true"
			preserveAspectRatio="xMidYMid slice"
		>
			<defs>
				<filter id="ex-hero-soft" x="-40%" y="-40%" width="180%" height="180%">
					<feGaussianBlur stdDeviation="60" />
				</filter>
			</defs>

			{/* Blurred floating aura. */}
			<g filter="url(#ex-hero-soft)" opacity="0.22">
				<circle cx="965" cy="120" r="150" fill="var(--on-primary)" />
				<circle cx="1130" cy="360" r="185" fill="var(--on-primary)" />
				<circle cx="150" cy="410" r="150" fill="var(--on-primary)" />
			</g>

			{/* Layered orbital frame + discovery nodes. */}
			<g fill="none" stroke="var(--on-primary)">
				<circle
					class="ex-hero__orbit"
					cx="1000"
					cy="240"
					r="205"
					stroke-width="1.5"
					stroke-dasharray="2 12"
					stroke-linecap="round"
					opacity="0.34"
				/>
				<circle
					class="ex-hero__orbit ex-hero__orbit--rev"
					cx="1000"
					cy="240"
					r="150"
					stroke-width="1"
					stroke-dasharray="1 16"
					stroke-linecap="round"
					opacity="0.5"
				/>
				<circle cx="1000" cy="240" r="96" stroke-width="1" opacity="0.26" />
				<circle cx="1000" cy="35" r="4" fill="var(--on-primary)" stroke="none" opacity="0.6" />
				<circle cx="1205" cy="240" r="3" fill="var(--on-primary)" stroke="none" opacity="0.5" />
				<circle cx="850" cy="152" r="2.5" fill="var(--on-primary)" stroke="none" opacity="0.45" />
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
				<path d="M120 150 L210 214 L168 326 M210 214 L322 182" />
				<circle cx="120" cy="150" r="3" fill="var(--on-primary)" stroke="none" />
				<circle cx="210" cy="214" r="3" fill="var(--on-primary)" stroke="none" />
				<circle cx="168" cy="326" r="3" fill="var(--on-primary)" stroke="none" />
				<circle cx="322" cy="182" r="3" fill="var(--on-primary)" stroke="none" />
			</g>
		</svg>
	);
}
