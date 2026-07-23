import type { JSX } from "preact";
import { ProductsMasonry } from "@features/explore/components/collections/ProductsMasonry.tsx";
import { Empty } from "./tab-shared.tsx";
import type { ProductItem } from "../../types/profile-types.ts";

/**
 * ProductsTab — the profile's Products / Portfolio tab body (both render the variable-height masonry;
 * root CLAUDE.md Part 2). Reuses the explore {@link ProductsMasonry} collection.
 */
export function ProductsTab(
	{ items, authed }: { items: ProductItem[]; authed: boolean },
): JSX.Element {
	return items.length ? <ProductsMasonry items={items} authed={authed} /> : <Empty />;
}
