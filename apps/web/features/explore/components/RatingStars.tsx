import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";

/**
 * RatingStars — a static, read-only rating glyph driven by a number. The library `Rating` is an
 * interactive input island; a display-only mark must not hydrate one per card, so this renders the
 * registry's `star` glyph, filled — the SAME geometry `@projective/ui/display`'s `RatingStars` draws,
 * rather than a second hand-authored path (§B.7.7). To save horizontal space on dense cards it shows
 * a SINGLE primary star (not a five-star meter); the {@link RatingTracks} row always renders the exact
 * numeric score beside it, so the star is a compact indicator rather than a fractional gauge. A single
 * accessible label carries the score; the glyph itself stays decorative.
 */
export function RatingStars(
	{ value: _value, label }: { value: number; label: string },
): JSX.Element {
	return (
		<span class="ex-stars ex-stars--single" role="img" aria-label={label}>
			<span class="ex-stars__fill" aria-hidden="true">
				<Icon name="star" size="xs" filled />
			</span>
		</span>
	);
}
