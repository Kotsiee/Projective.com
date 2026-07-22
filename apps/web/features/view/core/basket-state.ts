import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * The shopping-basket store for the Entity View page — a signal-backed, `localStorage`-persisted set
 * of item ids the visitor has added. A thin-frontend STUB until `/api/basket` lands: it gives the
 * sidebar CTA real, shared state (Add ⇄ In basket) that survives reloads and syncs across every island
 * on the page. Module-level, so the sidebar lane and any future basket surface in the same island
 * bundle observe one source of truth.
 */

// #region State
/** The set of basket item ids. Read lazily so SSR (no `localStorage`) starts empty and hydrates. */
export const basketIds = signal<readonly string[]>([]);

let hydrated = false;

/** Load the persisted basket once, on first client access. Safe to call repeatedly. */
export function hydrateBasket(): void {
	if (hydrated) return;
	hydrated = true;
	try {
		const raw = readStored("local", LocalKeys.BASKET);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) basketIds.value = parsed.filter((v) => typeof v === "string");
		}
	} catch {
		// corrupt / unavailable — start from an empty basket.
	}
}

function persist(): void {
	writeStored("local", LocalKeys.BASKET, JSON.stringify(basketIds.value));
}
// #endregion

// #region Mutations
/** Whether an item id is currently in the basket. */
export function inBasket(id: string): boolean {
	return basketIds.value.includes(id);
}

/** Add an item to the basket (idempotent). */
export function addToBasket(id: string): void {
	if (basketIds.value.includes(id)) return;
	basketIds.value = [...basketIds.value, id];
	persist();
}

/** Remove an item from the basket. */
export function removeFromBasket(id: string): void {
	if (!basketIds.value.includes(id)) return;
	basketIds.value = basketIds.value.filter((v) => v !== id);
	persist();
}

/** Toggle basket membership; returns the resulting state (`true` = now in basket). */
export function toggleBasket(id: string): boolean {
	if (inBasket(id)) {
		removeFromBasket(id);
		return false;
	}
	addToBasket(id);
	return true;
}
// #endregion
