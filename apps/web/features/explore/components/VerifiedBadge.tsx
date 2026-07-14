import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";

/**
 * VerifiedBadge — the premium identity-verification mark shown beside a verified owner's name. Not a
 * plain tick/checkbox: a custom geometric crest — a faceted twelve-lobe seal, a concentric inner
 * ring, and a confident tick — rendered as inline SVG in `currentColor` (tinted `--primary` by CSS),
 * so it scales crisply and themes with the palette. The tip is delivered through the shared
 * {@link Tooltip} (never a bare `title`), matching the app-wide tooltip treatment.
 */
export function VerifiedBadge(
	{ size = "sm", label = "Verified" }: { size?: "sm" | "md" | "lg"; label?: string },
): JSX.Element {
	return (
		<Tooltip content={label} placement="top">
			<span class={`ex-verified ex-verified--${size}`} role="img" aria-label={label}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					{/* Faceted twelve-lobe seal — the crest silhouette. */}
					<path
						class="ex-verified__seal"
						d="M12 1.6l2.05 1.4 2.45-.42 1.03 2.26 2.26 1.03-.42 2.45 1.4 2.05-1.4 2.05.42 2.45-2.26 1.03-1.03 2.26-2.45-.42L12 22.4l-2.05-1.4-2.45.42-1.03-2.26-2.26-1.03.42-2.45L3.23 12l-1.4-2.05.42-2.45 2.26-1.03 1.03-2.26 2.45.42z"
					/>
					{/* Concentric inner ring — the "double ring" read. */}
					<circle class="ex-verified__ring" cx="12" cy="12" r="7.1" />
					{/* The tick. */}
					<path
						class="ex-verified__tick"
						d="m8.6 12.3 2.3 2.3 4.6-4.9"
						fill="none"
						stroke-width="1.9"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</span>
		</Tooltip>
	);
}
