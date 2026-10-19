import type { JSX, Ref } from "preact";

/** Props for {@link BackgroundFallback}. */
export interface BackgroundFallbackProps {
	/** Which background this is; only the hero's exists today. */
	variant?: "hero";
	/** The background element, for the island's effects. */
	hostRef?: Ref<HTMLDivElement>;
}

/**
 * BackgroundFallback — the hero background's static paint, and the whole picture without
 * JavaScript (`flows/LANDING.md` §3.6): the solid canvas, the B7 grid and its spotlight at the SSR
 * position, and the B10 grain (Decision #288 retired the B1 constellation). It fills its parent
 * (`inset: 0`) behind the hero copy, is decorative (`aria-hidden`, no role) and inert to the
 * pointer, and takes no layout space, so it is LCP-safe and shifts nothing.
 *
 * The grid and the grain are the element's own pseudo-elements; `.lp-bg__spot` carries the
 * spotlight's disc and `.lp-bg__lit` the brighter grid under it, both moved by the island only.
 */
export function BackgroundFallback(
	{ variant = "hero", hostRef }: BackgroundFallbackProps,
): JSX.Element {
	return (
		<div ref={hostRef} class={`lp-bg lp-bg--${variant}`} aria-hidden="true" role="none">
			<div class="lp-bg__spot" />
			<div class="lp-bg__lit" />
		</div>
	);
}
