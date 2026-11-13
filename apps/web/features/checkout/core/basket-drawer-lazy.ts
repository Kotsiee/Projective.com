import { lazyComponent } from "@web/utils/lazy-component.ts";
import type { BasketDrawerPanelProps } from "../components/BasketDrawerPanel.tsx";

/** The header basket drawer's UI, in its own chunk: fetched on intent or on first open. */
export const basketDrawerPanel = lazyComponent<BasketDrawerPanelProps>(
	"the basket drawer",
	() => import("../components/BasketDrawerPanel.tsx").then((m) => m.BasketDrawerPanel),
);

/** Start fetching the drawer — the header trigger calls it on hover and focus. */
export function preloadBasketDrawer(): void {
	void basketDrawerPanel.load();
}
