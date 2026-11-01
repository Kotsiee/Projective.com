import type { JSX } from "preact";
import SearchBar from "@features/marketing/islands/SearchBar.island.tsx";
import HeroPatternGlow from "../islands/HeroPatternGlow.island.tsx";
import { HeroWeave } from "./HeroWeave.tsx";

/**
 * ExploreHomeHeader — the discovery hero (Decisions #350, #351, #353).
 *
 * No band and no card: the hero is the page canvas itself, so it runs straight into the rails below
 * with no edge between them. It stacks three layers, bottom to top:
 *
 *   1. {@link HeroPatternGlow} — the teal underlay light, a canvas that paints only where the weave's
 *      straps run (every audience: the guest's `/` and the signed-in `/explore` alike);
 *   2. the stencil ({@link HeroWeave}) — interlaced eight-point star strapwork (a khatam lattice) in
 *      translucent strokes (lighter than the canvas in dark mode, darker in light), so the light
 *      beneath shines up through them, under a static radial mask that lets the pattern fade into
 *      the negative space;
 *   3. the content — the h1 (display register, `--fw-medium`, its last words a tonal italic accent),
 *      on the gateway one sentence of positioning, then the shared `SearchBar`, an elevated command
 *      pill whose own prompt row ("Try") runs a search for a real query in one press.
 *
 * `gateway` (the guest's front page `/`) makes it the fold: the full width, `78svh` tall, with the
 * sentence. Without it (the signed-in hub) the hero keeps its content height and says nothing a
 * member already knows, but carries the same pattern and light.
 */
export function ExploreHomeHeader({ gateway = false }: { gateway?: boolean }): JSX.Element {
	return (
		<section class={`ex-hero${gateway ? " ex-hero--gateway" : ""}`}>
			<HeroPatternGlow />
			<div class="ex-hero__stencil" aria-hidden="true">
				<HeroWeave />
			</div>
			<div class="ex-hero__content">
				<h1 class="ex-hero__title">
					Find the people who <em class="ex-hero__accent">make it real.</em>
				</h1>
				{gateway && (
					<p class="ex-hero__lede">
						The marketplace for collaborative talent and modular teams.
					</p>
				)}
				<div class="ex-hero__search">
					<SearchBar variant="hero" slashFocus />
				</div>
			</div>
		</section>
	);
}
