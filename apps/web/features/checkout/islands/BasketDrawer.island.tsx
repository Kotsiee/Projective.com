import type { JSX } from "preact";
import { type Signal, useSignalEffect } from "@preact/signals";
import "../styles/checkout.css";
import { activeOwner } from "../core/basket-state.ts";
import { basketHref } from "../core/basket-model.ts";
import { useBasketDrawerScope } from "../core/useBasketDrawerScope.ts";
import { basketDrawerPanel } from "../core/basket-drawer-lazy.ts";

// #region Props
/** Props for {@link BasketDrawer}. */
export interface BasketDrawerProps {
	/** Open state, owned by the header's Basket control. */
	open: Signal<boolean>;
	/**
	 * The acting account's basket scope (`personal` · `team:{id}` · …), derived from the hydrated
	 * `UserContext` by the shell. Seeded into the shared store only on a surface that does not own its
	 * own scope — `/checkout` resolves its scope from the URL, and a drawer overwriting that would
	 * silently re-point the page under the reader.
	 */
	owner: string;
}
// #endregion

/**
 * BasketDrawer — the header Basket utility's light host (DESIGN_SYSTEM §D.1). It ships with the shell
 * and runs only the data half ({@link useBasketDrawerScope}), so the header's basket dot reads a real
 * count from the first paint; the drawer UI (`BasketDrawerPanel`) arrives in its own chunk on the
 * trigger's hover or focus, or on first open, and opens as soon as it lands. If that chunk cannot be
 * fetched, the press still goes somewhere — the full basket page. The checkout stylesheet barrel is
 * imported here, statically, because a sheet only reaches the page through an island's module graph.
 */
export default function BasketDrawer(props: BasketDrawerProps): JSX.Element | null {
	const { open, owner } = props;
	const scope = useBasketDrawerScope(open, owner);

	useSignalEffect(() => {
		if (!open.value || basketDrawerPanel.component.peek()) return;
		void basketDrawerPanel.load().then((panel) => {
			if (panel || !open.peek()) return;
			open.value = false;
			globalThis.location.assign(basketHref(null, activeOwner.peek()));
		});
	});

	const Panel = basketDrawerPanel.component.value;
	return Panel ? <Panel open={open} scope={scope} /> : null;
}
