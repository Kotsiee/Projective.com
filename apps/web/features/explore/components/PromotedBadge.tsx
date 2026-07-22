import type { JSX } from "preact";

/**
 * PromotedBadge — the small, subtle "Promoted" marker shown on sponsored services, products, and
 * profiles across the Explore + Search feeds. It sits in a card's top-corner overlay flag stack
 * ({@link `.ex-flags`}), so it never obscures the primary metadata. A soft dot + label reads as a
 * gentle disclosure, not a loud ad chip (§B.4 — colour + a hairline, no heavy fill). Zero client JS.
 */
export function PromotedBadge(
	{ label = "Promoted" }: { label?: string },
): JSX.Element {
	return (
		<span class="ex-promoted">
			<span class="ex-promoted__dot" aria-hidden="true" />
			{label}
		</span>
	);
}
