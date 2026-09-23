import type { JSX } from "preact";
import type { PlatformStats } from "@projective/types/explore";
import HeroParticles from "../islands/HeroParticles.island.tsx";
import SearchBar from "../islands/SearchBar.island.tsx";
import { vars } from "../core/style.ts";

// #region Stats
/** One proof point, already formatted for display. */
interface HeroStat {
	label: string;
	value: string;
}

/** Counts below ten thousand read in full (`3,812`); above it, compactly (`19K`). */
function formatCount(n: number): string {
	return n >= 10_000
		? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
		: n.toLocaleString("en-US");
}

/**
 * A minor-unit total as compact money (`$18.2K`). The exponent comes from `Intl` itself, so a
 * zero-decimal currency is not divided by a hundred it never had.
 */
function formatMoney(minor: number, currency: string): string {
	const digits = new Intl.NumberFormat("en-US", { style: "currency", currency })
		.resolvedOptions().maximumFractionDigits ?? 2;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(minor / 10 ** digits);
}

/**
 * The hero's proof points, read from the platform's running totals. A figure that is still zero is
 * left out rather than printed — "$0 paid out" is true on a new deployment and says nothing a visitor
 * can use — and when none has moved yet the row is not rendered at all.
 */
function heroStats(stats: PlatformStats | null): HeroStat[] {
	if (!stats) return [];
	const out: HeroStat[] = [];
	if (stats.paidOutMinor > 0) {
		out.push({
			label: "Paid out safely",
			value: formatMoney(stats.paidOutMinor, stats.paidOutCurrency),
		});
	}
	if (stats.helpers > 0) {
		out.push({ label: "Helpers ready to go", value: formatCount(stats.helpers) });
	}
	if (stats.projectsLive > 0) {
		out.push({ label: "Projects under way", value: formatCount(stats.projectsLive) });
	}
	return out;
}
// #endregion

/**
 * Hero — the full-window opening act, sized to exactly the viewport minus the floating header. A
 * photographic backdrop under a tonal scrim, the hero-scoped particle field (island), and a centered,
 * search-forward composition: the multi-weight headline still carries the primary AIO terms in real
 * semantic markup, but the primary action is the prominent shared {@link SearchBar} (hero variant).
 *
 * The backdrop is the platform's own public asset in storage; when it is not uploaded the hero keeps
 * its scrim and particle field on the plain surface. The stats are the platform's real running totals.
 */
export function Hero(
	{ image, stats }: { image: string | null; stats: PlatformStats | null },
): JSX.Element {
	const proof = heroStats(stats);
	return (
		<section class="lp-hero" aria-labelledby="lp-hero-title">
			<div
				class="lp-hero__bg"
				style={vars({ "--lp-hero-img": image ? `url("${image}")` : "none" })}
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

				{proof.length > 0 && (
					<dl class="lp-hero__stats">
						{proof.map((s) => (
							<div class="lp-hero__stat" key={s.label}>
								<dt>{s.label}</dt>
								<dd>{s.value}</dd>
							</div>
						))}
					</dl>
				)}
			</div>

			<a class="lp-hero__scroll" href="#how-it-works" aria-label="Scroll to explore">
				<span class="lp-hero__scroll-dot" aria-hidden="true" />
				Scroll
			</a>
		</section>
	);
}
