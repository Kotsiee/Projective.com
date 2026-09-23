import { useEffect } from "preact/hooks";
import { activeBasketId, activeOwner, displayCurrency, seedCheckoutContext } from "./basket-state.ts";

/**
 * checkout-context — seeds the `/basket` + `/checkout` surfaces' shared read context from their SSR
 * props, so every hydration root's first request asks for exactly the scope the server already painted.
 *
 * The regions of the checkout are separate hydration roots (lane · header band · footer band · body)
 * that share module-level signals ({@link seedCheckoutContext}); these hooks are how each one publishes
 * the scope it was rendered for. Nothing here simulates anything: the basket, the paying account, its
 * wallet and cards are read live, as the signed-in caller, every time.
 */

// #region Hooks
/** The scope a surface was server-rendered for. */
export interface CheckoutContextSeed {
	basketId: string | null;
	owner: string;
	display: string;
	projectId?: string | null;
	serviceId?: string | null;
}

/**
 * Seed the shared context for a surface that OWNS its reads (a checkout step's body). Re-seeds when the
 * server-rendered scope changes, which only a navigation does.
 */
export function useCheckoutContext(seed: CheckoutContextSeed): void {
	const { basketId, owner, display, projectId, serviceId } = seed;
	useEffect(() => {
		seedCheckoutContext({ basketId, owner, display, projectId, serviceId });
	}, [basketId, owner, display, projectId, serviceId]);
}

/**
 * The lighter half of {@link useCheckoutContext}, for a region that renders the shared state but owns
 * no fetch (the lane, a band). It fills only what no body has published yet, so a band never overwrites
 * the scope the body seeded — the two hydrate in an order neither may assume.
 */
export function useCheckoutContextPassive(seed: Pick<CheckoutContextSeed, "basketId" | "owner" | "display">): void {
	const { basketId, owner, display } = seed;
	useEffect(() => {
		if (activeBasketId.value === null) activeBasketId.value = basketId;
		if (activeOwner.value === "personal") activeOwner.value = owner;
		displayCurrency.value = display;
	}, [basketId, owner, display]);
}
// #endregion
