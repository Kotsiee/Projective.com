import type { JSX } from "preact";
import { WEAVE_PATH, WEAVE_STROKE, WEAVE_TILE } from "../core/hero-weave.ts";

/**
 * HeroWeave — the Explore headers' stencil (Decisions #351, #353, #357): the strapwork tile
 * ({@link WEAVE_PATH}) as an SVG pattern filling its box, in one translucent stroke (`.ex-weave`,
 * `explore.css`). Purely decorative; the header that places it owns its position and its mask.
 */
export function HeroWeave(): JSX.Element {
	return (
		<svg class="ex-weave" aria-hidden="true" focusable="false">
			<defs>
				<pattern
					id="ex-weave"
					width={WEAVE_TILE}
					height={WEAVE_TILE}
					patternUnits="userSpaceOnUse"
				>
					<g
						class="ex-weave__line"
						fill="none"
						stroke-width={WEAVE_STROKE}
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d={WEAVE_PATH} />
					</g>
				</pattern>
			</defs>
			<rect width="100%" height="100%" fill="url(#ex-weave)" />
		</svg>
	);
}
