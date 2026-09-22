import type { ComponentChildren, JSX } from "preact";
import { RailHeading } from "./RailHeading.tsx";

/**
 * HomeGrid — a Home section laid out as a fixed grid instead of a scrolling rail.
 *
 * The Projects section uses it. A project card has no media, so it is the one card in the family whose
 * height is genuinely predictable — and a brief is something a reader COMPARES rather than browses
 * past. Four of them in a 2×2 block can all be read at once; the same four in a rail put two of them
 * behind a gesture for no gain.
 *
 * It is a plain SERVER component with no island, because a grid has nothing to drive: no scroll
 * position, so no progress bar, and no overflow, so no paging arrows. Rendering the rail island here
 * and hiding its controls would ship a hydration root to run an empty `useCarousel`.
 *
 * The heading is the shared {@link RailHeading}, so this section and every rail beside it cannot drift
 * on the one thing a reader reads as repeated.
 *
 * The Search Results feed renders its projects section here too, for the same reason Home does — and
 * passes an `action`, which Home does not. There the heading link is not the only way to reach the
 * full category, and "show all of this" is a primary act rather than a footnote.
 */
export function HomeGrid(
	{ id, lead, tail, href, action, children }: {
		id: string;
		lead: string;
		tail: string;
		href?: string;
		/** Optional trailing affordance in the header — see {@link RailFrame}'s `action`. */
		action?: ComponentChildren;
		children: ComponentChildren;
	},
): JSX.Element {
	return (
		<section class="ex-rail" id={`ex-${id}`} aria-labelledby={`ex-${id}-title`}>
			<header class="ex-rail__head">
				<RailHeading id={id} lead={lead} tail={tail} href={href} />
				{action}
			</header>
			<div class="ex-rail__grid" role="list">{children}</div>
		</section>
	);
}
