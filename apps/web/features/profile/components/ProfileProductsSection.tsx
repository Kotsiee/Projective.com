import type { JSX } from "preact";
import { ProductMasonryGrid } from "@features/explore/components/collections/ProductMasonryGrid.tsx";
import RowClamp from "../islands/RowClamp.island.tsx";
import { PRODUCTS_ANCHOR } from "../core/profile-model.ts";
import type { ProductItem } from "../types/profile-types.ts";

/**
 * ProfileProductsSection — a seller's ready-to-buy digital products as their own region, rendered by
 * the layout directly BENEATH the Services row so both stay on screen whichever section is routed.
 * The tiles are the SAME `ProductMasonryGrid` `/explore` renders — a CSS-column masonry sized from
 * each cover's clamped ratio — and the `RowClamp` island around it shows only the masonry's first
 * row (exactly its column count of tiles, in a grid of the same count) until "Show all" opens the
 * full interlocking columns. Renders nothing for a buyer entity or an empty catalogue.
 *
 * A SERVER component: the tile markup never crosses the hydration boundary as data.
 */
export interface ProfileProductsSectionProps {
	products: ProductItem[];
	authed: boolean;
}

export function ProfileProductsSection(
	{ products, authed }: ProfileProductsSectionProps,
): JSX.Element | null {
	if (products.length === 0) return null;
	const headingId = `${PRODUCTS_ANCHOR}-heading`;
	return (
		<section id={PRODUCTS_ANCHOR} class="pf-products ex" aria-labelledby={headingId}>
			<h2 id={headingId} class="pf-h">Products</h2>
			<RowClamp
				count={products.length}
				id="profile-products-grid"
				selector=".ex-pmasonry__cols"
			>
				<ProductMasonryGrid items={products} authed={authed} label="Products" />
			</RowClamp>
		</section>
	);
}
