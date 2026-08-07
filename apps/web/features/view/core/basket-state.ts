import { signal } from "@preact/signals";
import type { ExploreItem } from "@projective/types/explore";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { BasketService } from "@web/features/checkout/core/BasketService.ts";
import { addPayloadFor, purchasableKindOf } from "@web/features/checkout/core/purchasable.ts";
import {
	activeBasketId,
	applyBasket,
	applyResponse,
	currentCheckoutContext,
	notifyBasketChanged,
} from "@web/features/checkout/core/basket-state.ts";

/**
 * The Entity View page's basket adapter.
 *
 * It used to be a `localStorage`-only stub: "Add to basket" recorded an id in the browser and nothing
 * anywhere could ever charge for it. It now writes through the thin {@link BasketService} to the real
 * `/api/basket` contract, so a CTA on a listing page and the header basket drawer describe the same
 * basket.
 *
 * **The local id set survives on purpose, as an optimistic MIRROR — not as a second basket.** The two
 * CTA stacks (the lane and the ≤767px buy bar) read it synchronously to render "Add to basket ⇄ In
 * basket", and a server round trip per keystroke of feedback would make a button that appears not to
 * respond. The server's answer always wins: {@link syncBasket} replaces the mirror wholesale from the
 * resolved basket, and a refused write reverts it.
 *
 * **Membership is keyed on the listing id, removal on the LINE id.** They are different identifiers —
 * one basket line is `bi-…` and points at an `sv-…`/`pd-…` listing — so the adapter keeps the map
 * rather than making each caller resolve it, which is how a "Remove" comes to delete the wrong row.
 */

// #region State
/** The listing ids currently in the acting account's basket. Read synchronously by both CTA stacks. */
export const basketIds = signal<readonly string[]>([]);

/** Listing id → the basket line that holds it, so a removal names the right row. */
const lineByItem = new Map<string, string>();

let hydrated = false;

/** Persist the optimistic mirror, so a reload paints the right CTA before the server answers. */
function persist(): void {
	writeStored("local", LocalKeys.BASKET, JSON.stringify(basketIds.value));
}

/**
 * Replace the mirror from the SERVER's basket.
 *
 * A failed read leaves the persisted mirror in place rather than clearing it: an outage is not evidence
 * that the buyer's basket is empty, and a CTA that silently flips back to "Add to basket" invites a
 * second line for something already in there.
 */
export async function syncBasket(): Promise<void> {
	const res = await BasketService.get(currentCheckoutContext());
	if (!applyResponse(res, applyBasket)) return;
	const basket = res.data?.basket;
	if (!basket) return;
	lineByItem.clear();
	const ids: string[] = [];
	for (const line of basket.items) {
		if (line.savedForLater) continue;
		lineByItem.set(line.itemId, line.id);
		ids.push(line.itemId);
	}
	basketIds.value = ids;
	persist();
}

/**
 * Restore the persisted mirror, then reconcile it against the server. Safe to call repeatedly — the
 * server read runs once per page, from whichever CTA mounts first.
 */
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
		// Corrupt / unavailable — the server read below is the real answer anyway.
	}
	void syncBasket();
}
// #endregion

// #region Queries
/** Whether a listing is currently in the basket. */
export function inBasket(id: string): boolean {
	return basketIds.value.includes(id);
}

/** Whether a listing can be put in a basket at all (a profile or an article cannot). */
export function isPurchasable(item: ExploreItem): boolean {
	return purchasableKindOf(item) !== null;
}
// #endregion

// #region Mutations
/** The outcome of a basket write, for the CTA's `role="status"` line. */
export interface BasketWriteResult {
	ok: boolean;
	/** Whether the listing is in the basket AFTER the write. */
	inBasket: boolean;
	/** The server's own sentence, or the reason it refused. */
	message: string;
}

/**
 * Add a listing to the acting account's basket.
 *
 * `basketId: null` lands it in the default basket unless a basket is already open elsewhere in the
 * session, so an add from a listing page needs no prior lookup. The add is idempotent server-side —
 * a repeat increments the existing line's quantity rather than stacking a second one.
 */
export async function addToBasket(item: ExploreItem): Promise<BasketWriteResult> {
	const payload = addPayloadFor(item, activeBasketId.value);
	if (!payload) {
		return { ok: false, inBasket: false, message: "That listing can't be bought on its own." };
	}
	const before = basketIds.value;
	if (!before.includes(item.id)) {
		basketIds.value = [...before, item.id];
		persist();
	}

	const res = await BasketService.addItem(payload, currentCheckoutContext());
	if (!applyResponse(res, applyBasket)) {
		basketIds.value = before;
		persist();
		return {
			ok: false,
			inBasket: before.includes(item.id),
			message: res.message ?? "We couldn't add that to your basket.",
		};
	}
	adopt(res.data?.basket.items ?? []);
	notifyBasketChanged();
	return { ok: true, inBasket: true, message: res.message ?? "Added to basket." };
}

/** Remove a listing's line from the basket. */
export async function removeFromBasket(item: ExploreItem): Promise<BasketWriteResult> {
	const lineId = lineByItem.get(item.id);
	const before = basketIds.value;
	if (!lineId) {
		// Nothing on the server to remove — drop it from the mirror so the CTA stops claiming otherwise.
		basketIds.value = before.filter((id) => id !== item.id);
		persist();
		return { ok: true, inBasket: false, message: "Removed from basket." };
	}
	basketIds.value = before.filter((id) => id !== item.id);
	persist();

	const res = await BasketService.removeItem({ basketItemId: lineId }, currentCheckoutContext());
	if (!applyResponse(res, applyBasket)) {
		basketIds.value = before;
		persist();
		return {
			ok: false,
			inBasket: true,
			message: res.message ?? "We couldn't remove that from your basket.",
		};
	}
	adopt(res.data?.basket.items ?? []);
	notifyBasketChanged();
	return { ok: true, inBasket: false, message: res.message ?? "Removed from basket." };
}

/** Toggle basket membership, resolving to the state the SERVER settled on. */
export function toggleBasket(item: ExploreItem): Promise<BasketWriteResult> {
	return inBasket(item.id) ? removeFromBasket(item) : addToBasket(item);
}

/** Re-key the listing → line map from a basket the server just returned. */
function adopt(items: readonly { id: string; itemId: string; savedForLater: boolean }[]): void {
	lineByItem.clear();
	const ids: string[] = [];
	for (const line of items) {
		if (line.savedForLater) continue;
		lineByItem.set(line.itemId, line.id);
		ids.push(line.itemId);
	}
	basketIds.value = ids;
	persist();
}
// #endregion
