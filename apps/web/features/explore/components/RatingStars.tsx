import type { JSX } from "preact";

/**
 * RatingStars — a static, read-only rating glyph driven by a number. The library `Rating` is an
 * interactive input island; a display-only mark must not hydrate one per card, so this renders pure
 * SVG. To save horizontal space on dense cards it shows a SINGLE primary star (not a five-star meter);
 * the {@link RatingTracks} row always renders the exact numeric score beside it, so the star is a
 * compact indicator rather than a fractional gauge. A single accessible label carries the score.
 */
export function RatingStars(
	{ value: _value, label }: { value: number; label: string },
): JSX.Element {
	const star = "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z";
	return (
		<span class="ex-stars ex-stars--single" role="img" aria-label={label}>
			<span class="ex-stars__fill" aria-hidden="true">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d={star} fill="currentColor" />
				</svg>
			</span>
		</span>
	);
}
