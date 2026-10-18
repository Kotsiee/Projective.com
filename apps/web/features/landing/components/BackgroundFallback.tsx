import type { JSX, Ref } from "preact";
import {
	CONSTELLATION_SEED,
	type StaticConstellation,
	staticConstellation,
	type Zone,
} from "../core/constellation.ts";

/** Props for {@link BackgroundFallback}. */
export interface BackgroundFallbackProps {
	/** Which background this is; names the quiet-zone mask so two never share an id. */
	variant?: "hero";
	/**
	 * The quiet zones the island measured, or `null` before it has (the server, no JS, or before
	 * hydration): the stylesheet then clears a conservative centre column instead.
	 */
	zones?: readonly Zone[] | null;
	/** The background element, for the island's effects. */
	hostRef?: Ref<HTMLDivElement>;
}

let layout: StaticConstellation | null = null;

/** The static constellation, computed once per module on first render (never at import). */
function constellation(): StaticConstellation {
	layout ??= staticConstellation(CONSTELLATION_SEED);
	return layout;
}

const px = (value: number) => value.toFixed(1);

/**
 * BackgroundFallback — the hero background's static paint, and the whole picture without
 * JavaScript (`flows/LANDING.md` §3.6): the canvas paint, the B7 grid and spotlight at their SSR
 * position, the B10 grain and the B1 constellation as an SVG, every team already gathered. It fills
 * its parent (`inset: 0`) behind the hero copy, is decorative (`aria-hidden`, no role) and inert to
 * the pointer, and takes no layout space, so it is LCP-safe and shifts nothing.
 *
 * The constellation comes from the same seeded layout the live canvas uses, laid out in percent of
 * the box, so the server and every client render identical markup. Measured quiet zones become a
 * luminance mask: copy keeps the quiet alpha, the search halo is cleared. `.lp-bg__gl` is the slot
 * the WebGL2 canvas mounts into; the stylesheet crossfades it in once its first frame is drawn.
 */
export function BackgroundFallback(
	{ variant = "hero", zones = null, hostRef }: BackgroundFallbackProps,
): JSX.Element {
	const { nodes, links } = constellation();
	const maskId = `lp-bg-quiet-${variant}`;
	return (
		<div
			ref={hostRef}
			class={`lp-bg lp-bg--${variant}`}
			aria-hidden="true"
			role="none"
			data-lp-zones={zones ? "measured" : undefined}
		>
			<div class="lp-bg__spot" />
			<div class="lp-bg__lit" />
			<svg
				class="lp-bg__layer lp-constellation"
				width="100%"
				height="100%"
				aria-hidden="true"
				focusable="false"
			>
				{zones && (
					<defs>
						<mask
							id={maskId}
							maskUnits="userSpaceOnUse"
							x="0"
							y="0"
							width="100%"
							height="100%"
						>
							<rect class="lp-constellation__keep" width="100%" height="100%" />
							{zones.map((z, i) => (
								<rect
									key={i}
									class={`lp-constellation__zone lp-constellation__zone--${z.kind}`}
									x={px(z.x0)}
									y={px(z.y0)}
									width={px(z.x1 - z.x0)}
									height={px(z.y1 - z.y0)}
								/>
							))}
						</mask>
					</defs>
				)}
				<g mask={zones ? `url(#${maskId})` : undefined}>
					<g class="lp-constellation__links">
						{links.map((l, i) => (
							<line
								key={i}
								class="lp-constellation__link"
								x1={l.x1}
								y1={l.y1}
								x2={l.x2}
								y2={l.y2}
								stroke-opacity={l.opacity}
							/>
						))}
					</g>
					<g class="lp-constellation__nodes">
						{nodes.map((n, i) => (
							<circle
								key={i}
								class="lp-constellation__node"
								cx={n.cx}
								cy={n.cy}
								r={n.r}
								fill-opacity={n.opacity}
							/>
						))}
					</g>
				</g>
			</svg>
			<div class="lp-bg__gl" />
		</div>
	);
}
