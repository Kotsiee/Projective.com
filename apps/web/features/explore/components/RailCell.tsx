import type { ComponentChildren, JSX } from "preact";

/**
 * RailCell — one cell in a {@link RailFrame} track: the fixed-width, stretch-height slot that gives a
 * row its flat top and bottom edge.
 *
 * Shared rather than declared per host for the same reason {@link RailHeading} is: the discovery Home
 * and the Search Results feed lay cards in the same track, and a cell that carried a different width
 * or dropped `role="listitem"` in one of them would break the uniform-height contract on exactly the
 * surface nobody was looking at. The width itself is the track's (`--ex-cell-w`), so a host narrows a
 * whole rail in one declaration.
 *
 * `featured` spans two cells (capped at the track's width) and is the container a sponsored
 * `PromoSlot` reflows against.
 */
export function RailCell(
	{ featured = false, facet, children }: {
		featured?: boolean;
		/** The value a rail's facet chips match this cell on (`data-facet`). */
		facet?: string;
		children: ComponentChildren;
	},
): JSX.Element {
	return (
		<div
			class={featured ? "ex-rail__cell ex-rail__cell--featured" : "ex-rail__cell"}
			role="listitem"
			data-facet={facet}
		>
			{children}
		</div>
	);
}
