import type { JSX } from "preact";
import { ProductCard } from "../cards/ProductCard.tsx";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProductItem } from "../../types/explore-types.ts";

/**
 * ProductMasonryGrid — products as a true CSS-column masonry, the same mechanism as the profile's
 * Selected-work tiles: `column-count` under container queries on a wrapper, `break-inside: avoid`
 * on every cell, zero client JS. Each tile's box is reserved from its cover's clamped ratio before
 * the bytes arrive (the card writes it as `--ex-prod-ratio`), so a column never reflows as pictures
 * land, and a tower or a panorama cannot run away with one — the band in `files/aspect.ts` crops it.
 *
 * Two elements on purpose: the outer `.ex-pmasonry` is the size container and the inner list takes
 * the columns, because an element cannot query its own inline size. The column count is ONE custom
 * property (`--ex-pmasonry-cols`) the columns read — and that a host clamping the grid to its first
 * row (the profile's `RowClamp`) reads too, so "one row" means the same number of tiles in both modes.
 *
 * `onSelect` wires the Search-Results detail drawer, where the masonry IS the feed; every other host
 * leaves it unset and a click navigates.
 */
export function ProductMasonryGrid(
	{ items, ctx, onSelect, authed = false, label = "Digital products" }: {
		items: ProductItem[];
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
		label?: string;
	},
): JSX.Element {
	return (
		<div class="ex-pmasonry">
			<ul class="ex-pmasonry__cols" role="list" aria-label={label}>
				{items.map((p) => (
					<li class="ex-pmasonry__cell" key={p.id}>
						<ProductCard item={p} ctx={ctx} onSelect={onSelect} authed={authed} />
					</li>
				))}
			</ul>
		</div>
	);
}
