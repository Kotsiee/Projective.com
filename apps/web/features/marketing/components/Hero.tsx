import type { JSX } from "preact";
import HeroParticles from "../islands/HeroParticles.island.tsx";
import SearchBar from "../islands/SearchBar.island.tsx";
import { unsplash } from "../core/landing-data.ts";
import { vars } from "../core/style.ts";

/**
 * Hero — the full-window opening act, sized to exactly the viewport minus the floating header. A
 * photographic backdrop under a tonal scrim, the hero-scoped particle field (island), and a centered,
 * search-forward composition: the multi-weight headline still carries the primary AIO terms in real
 * semantic markup, but the primary action is now the prominent shared {@link SearchBar} (hero variant).
 */
const HERO_BG = unsplash("1522071820081-009f0129c71c", 1920, 1280);

export function Hero(): JSX.Element {
	return (
		<section class="lp-hero" aria-labelledby="lp-hero-title">
			<div
				class="lp-hero__bg"
				style={vars({ "--lp-hero-img": `url("${HERO_BG}")` })}
				aria-hidden="true"
			/>
			<div class="lp-hero__scrim" aria-hidden="true" />
			<HeroParticles />

			<div class="lp-hero__inner lp-hero__inner--center">
				<span class="lp-eyebrow lp-hero__eyebrow">Help made simple</span>

				<h1 class="lp-hero__title" id="lp-hero-title">
					<span class="lp-hero__line">
						<span class="lp-hero__thin">Get a whole</span>{" "}
						<span class="lp-hero__strong">team of helpers</span>
					</span>
					<span class="lp-hero__line">
						<span class="lp-hero__thin">as easily as</span>{" "}
						<span class="lp-hero__strong">hiring one</span>
					</span>
				</h1>

				<p class="lp-hero__lede">
					Tell us what you need and we'll build the perfect team of helpers for you. Pay a little at
					a time — and only when you're happy with each step.
				</p>

				<div class="lp-hero__cta">
					<a class="lp-btn lp-btn--primary" href="/join" data-magnetic>Get started</a>
					<a class="lp-btn lp-btn--ghost" href="/explore" data-magnetic>Hire a team</a>
				</div>

				<SearchBar variant="hero" />

				<dl class="lp-hero__stats">
					<div class="lp-hero__stat">
						<dt>Paid out safely</dt>
						<dd>$4.2M</dd>
					</div>
					<div class="lp-hero__stat">
						<dt>Helpers ready to go</dt>
						<dd>3,800+</dd>
					</div>
					<div class="lp-hero__stat">
						<dt>Happy projects</dt>
						<dd>19k</dd>
					</div>
				</dl>
			</div>

			<a class="lp-hero__scroll" href="#how-it-works" aria-label="Scroll to explore">
				<span class="lp-hero__scroll-dot" aria-hidden="true" />
				Scroll
			</a>
		</section>
	);
}
