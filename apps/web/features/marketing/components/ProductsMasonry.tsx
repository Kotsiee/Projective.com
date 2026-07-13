import type { JSX } from "preact";
import { ProductCard } from "./ProductCard.tsx";
import type { ProductShowcase } from "../core/landing-data.ts";

/**
 * ProductsMasonry — a staggered vertical-column masonry of digital products. CSS multi-column flow
 * gives the effortless, print-like stagger without JS measurement; each card's `span` varies its
 * height so the columns interlock naturally. Zero client JS.
 */
export function ProductsMasonry({ products }: { products: ProductShowcase[] }): JSX.Element {
	return (
		<div class="lp-masonry" role="list">
			{products.map((p) => (
				<div class="lp-masonry__item" role="listitem" key={p.slug}>
					<ProductCard product={p} />
				</div>
			))}
		</div>
	);
}
