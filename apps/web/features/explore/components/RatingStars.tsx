import type { JSX } from "preact";
import { vars } from "@features/marketing/core/style.ts";

/**
 * RatingStars — a static, read-only five-star meter driven by a number. The library `Rating` is an
 * interactive input island; a display-only meter must not hydrate one per card, so this renders pure
 * SVG with a token-driven fill width (`--ex-fill`) and a single accessible label. Zero client JS.
 */
export function RatingStars(
	{ value, label }: { value: number; label: string },
): JSX.Element {
	const pct = `${(Math.max(0, Math.min(5, value)) / 5) * 100}%`;
	const star = "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.9 6.1 21l1.2-6.5L2.5 9.9l6.6-.9z";
	return (
		<span class="ex-stars" role="img" aria-label={label} style={vars({ "--ex-fill": pct })}>
			<span class="ex-stars__track" aria-hidden="true">
				<StarRow star={star} />
			</span>
			<span class="ex-stars__fill" aria-hidden="true">
				<StarRow star={star} />
			</span>
		</span>
	);
}

function StarRow({ star }: { star: string }): JSX.Element {
	return (
		<>
			{[0, 1, 2, 3, 4].map((i) => (
				<svg key={i} viewBox="0 0 24 24" aria-hidden="true">
					<path d={star} fill="currentColor" />
				</svg>
			))}
		</>
	);
}
