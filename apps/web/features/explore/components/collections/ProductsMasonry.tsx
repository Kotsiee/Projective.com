import type { JSX } from "preact";
import { ProductCard } from "../cards/ProductCard.tsx";
import type { ProductItem } from "../../types/explore-types.ts";

/**
 * ProductsMasonry — products displayed as a dynamic staggered masonry. CSS multi-column flow gives the
 * print-like stagger with no JS measurement; each card's `span` varies its height so columns interlock.
 * Zero client JS (mirrors the marketing landing masonry).
 */
export function ProductsMasonry(
	{ items, authed = false }: { items: ProductItem[]; authed?: boolean },
): JSX.Element {
	return (
		<div class="ex-masonry" role="list" aria-label="Digital products">
			{items.map((p) => (
				<div class="ex-masonry__item" role="listitem" key={p.id}>
					<ProductCard item={p} authed={authed} />
				</div>
			))}
		</div>
	);
}
