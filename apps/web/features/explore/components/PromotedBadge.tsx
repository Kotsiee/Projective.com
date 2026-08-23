import type { JSX } from "preact";

/**
 * PromotedBadge — the paid-placement disclosure on a sponsored service, product, or profile.
 *
 * A circular glass "AD" token pinned to the TOP-RIGHT of the card's media. It is deliberately a
 * different object from the top-left {@link StatusChip}s: a trust signal the entity EARNED and a
 * placement the entity BOUGHT must never read as the same kind of badge sitting in the same stack.
 * Opposite corners, different shape, different surface.
 *
 * This is the one place in the card family where real glass is correct rather than a legibility
 * hazard. The chip contract's solid-surface rule exists because a translucent LABEL over photography
 * measured 3.05:1 — but "AD" is two letters at heavy weight over a blurred backdrop, carrying both an
 * outer border and a text shadow, and it is a disclosure whose job is to be unmistakably an overlay
 * rather than part of the image. The blur is what says "this was placed here".
 *
 * `aria-label` carries the expanded word: a screen reader announcing the letters "A D" is not a
 * disclosure, and the visible glyph stays two characters so the circle can be small.
 */
export function PromotedBadge(
	{ label = "Sponsored" }: { label?: string },
): JSX.Element {
	return (
		<span class="ex-ad" role="img" aria-label={label}>
			<span class="ex-ad__text" aria-hidden="true">AD</span>
		</span>
	);
}
