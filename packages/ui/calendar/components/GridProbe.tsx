/**
 * @projective/ui/calendar — the palette probe: the bridge between the token contract and a canvas.
 *
 * A `CanvasRenderingContext2D` has no access to the cascade — it cannot read a custom property, a
 * `color-mix()`, a generated Material tone or an accessibility overlay — and this package may not
 * hold a colour, a radius, a font or a duration of its own. So every drawing value is authored where
 * it belongs, in `calendar.css`, on a hidden subtree whose only job is to be MEASURED: each swatch
 * carries one value as an ordinary declaration against `var(--*)`, and {@link useGridCanvas} reads
 * the engine's RESOLVED result back. Nothing is drawn from this subtree; no number ever moves into
 * TypeScript.
 *
 * It is a component of its own rather than a fragment inside {@link GridCanvas} because the two
 * timed views need it in different places. The hybrid Day timeline can nest it beside its canvas;
 * the pure-canvas Week viewport must keep its viewport element genuinely EMPTY, so it renders the
 * probe as a sibling instead. One definition, two mount points, no second copy of the swatch list to
 * drift.
 *
 * ACCENTS ARE DATA. The fixed swatches cover the lattice and the chrome, but a card's accent is
 * whichever token its kind resolves to — or whatever custom property the consumer put on the event —
 * so the caller passes the set actually present in the scene and gets one swatch each. A week with
 * no deadlines in it renders no `--danger` swatch, which is why `useGridCanvas` invalidates its
 * cached palette on the accent key rather than on the theme alone.
 */
import type { JSX } from "preact";
import type { RefObject } from "preact";
import { styleVars } from "../../core/style.ts";
import { edgeFor, onAccentFor } from "../core/kinds.ts";

export interface GridProbeProps {
	/** Attach to read the swatches back. */
	probeRef: RefObject<HTMLDivElement>;
	/**
	 * Accent custom-property NAMES to resolve a card paint for (e.g. `"--danger"`). Empty for a view
	 * that paints only the lattice, which is the hybrid Day timeline.
	 */
	accents?: readonly string[];
	/**
	 * Whether to render the swatches the FULL viewport pass needs — the text styles, the chrome and
	 * the card metrics. A lattice-only host omits them and their computed styles are never read.
	 */
	scene?: boolean;
}

export function GridProbe(
	{ probeRef, accents = [], scene = false }: GridProbeProps,
): JSX.Element {
	return (
		<div ref={probeRef} class="cal-grid__probe" aria-hidden="true">
			<span class="cal-grid__swatch cal-grid__swatch--rule" />
			<span class="cal-grid__swatch cal-grid__swatch--boundary" />
			<span class="cal-grid__swatch cal-grid__swatch--band" />
			<span class="cal-grid__swatch cal-grid__swatch--band-edge" />
			<span class="cal-grid__swatch cal-grid__swatch--blackout" />
			{scene
				? (
					<>
						<span class="cal-grid__swatch cal-grid__swatch--hour" />
						<span class="cal-grid__swatch cal-grid__swatch--title" />
						<span class="cal-grid__swatch cal-grid__swatch--meta" />
						<span class="cal-grid__swatch cal-grid__swatch--masked" />
						<span class="cal-grid__swatch cal-grid__swatch--marker" />
						<span class="cal-grid__swatch cal-grid__swatch--card" />
						<span class="cal-grid__swatch cal-grid__swatch--glyph" />
						<span class="cal-grid__swatch cal-grid__swatch--now" />
						<span class="cal-grid__swatch cal-grid__swatch--selection" />
						<span class="cal-grid__swatch cal-grid__swatch--bar" />
						<span class="cal-grid__swatch cal-grid__swatch--bar-hit" />
						<span class="cal-grid__swatch cal-grid__swatch--ball" />
						<span class="cal-grid__swatch cal-grid__swatch--pill" />
						<span class="cal-grid__swatch cal-grid__swatch--focus" />
						<span class="cal-grid__swatch cal-grid__swatch--tooltip" />
						<span class="cal-grid__swatch cal-grid__swatch--avatar" />
						<span class="cal-grid__swatch cal-grid__swatch--badge" />
						<span class="cal-grid__swatch cal-grid__swatch--lift" />
						<span class="cal-grid__swatch cal-grid__swatch--pin" />
					</>
				)
				: null}
			{accents.map((token) => (
				/*
				 * Writing `--cal-accent` inline is the established pattern for this value — it is what
				 * the DOM event card does to accent itself — and it is a token REFERENCE, never a colour:
				 * the five declarations that read it live in `calendar.css`. `--cal-accent-on` rides
				 * alongside it, resolved by the SAME `--x` → `--on-x` convention `onAccentFor` derives
				 * from the accent's own name, so a card's ink can never point at a different accent than
				 * its fill does.
				 */
				<span
					key={token}
					class="cal-grid__swatch cal-grid__swatch--accent"
					data-accent={token}
					style={styleVars({
						"--cal-accent": `var(${token})`,
						"--cal-accent-on": `var(${onAccentFor(token)})`,
						/*
						 * The optional EDGE pair, resolved through a `var()` FALLBACK rather than a branch: an
						 * accent that declares no `--x-edge` gets `transparent` at `0px`, which is the
						 * palette's own "draw nothing" signal, so the five unbordered groups and the one
						 * bordered one flow through identical markup and an identical read.
						 */
						"--cal-accent-edge": `var(${edgeFor(token).colour}, transparent)`,
						"--cal-accent-edge-w": `var(${edgeFor(token).width}, 0px)`,
					})}
				/>
			))}
		</div>
	);
}
