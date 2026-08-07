import { computed, signal } from "@preact/signals";
import type { PurchasableItemKind } from "../types/checkout-types.ts";

/**
 * buy-now-state — the cross-island bridge that opens the Buy-Now modal.
 *
 * A discovery page carries the purchase CTA in two mutually-exclusive places: the middle-nav action
 * lane above 767px, and the in-body buy bar below it. They are separate hydration roots, so — like the
 * board's footer ⇄ body and the inbox's four regions — they cannot pass props and share module signals
 * instead.
 *
 * **The host registry below is not ceremony.** Both CTAs are always mounted (they are hidden from each
 * other by `display`, not unmounted), and the modal renders through `BodyPortal`, which escapes a
 * hidden ancestor entirely — so two mounted hosts would composite two identical modals, two focus traps
 * and two charges of the same idempotency key. Exactly one host renders the panel, chosen by a fixed
 * priority rather than by mount order, so the winner cannot change between renders.
 */

// #region Target
/** What a Buy-Now attempt is for. Enough to add the line and to name it while the session resolves. */
export interface BuyNowTarget {
	/** The purchasable's discovery id. */
	itemId: string;
	/** How the SSOT classifies it — resolved once by `purchasableKindOf`, never re-derived per surface. */
	itemType: PurchasableItemKind;
	/** The listing title, shown while the server projection is still resolving. */
	title: string;
	/** The seller's display name, or `null`. */
	sellerName: string | null;
	/** Where a signed-out visitor is sent, returning here afterwards. */
	signInHref: string;
}

/** Whether the Buy-Now modal is open. */
export const buyNowOpen = signal<boolean>(false);

/** What the open modal is buying; `null` when nothing is in flight. */
export const buyNowTarget = signal<BuyNowTarget | null>(null);

/**
 * Ask for an instant checkout of `target`.
 *
 * A signed-out visitor is routed to sign-in instead of being shown a modal that cannot complete: every
 * `/api/checkout/*` call resolves against an acting account, so a guest would reach a provider list
 * with nothing on it and a Pay control that could only ever refuse.
 */
export function requestBuyNow(target: BuyNowTarget, authed: boolean): void {
	if (!authed) {
		globalThis.location.href = target.signInHref;
		return;
	}
	buyNowTarget.value = target;
	buyNowOpen.value = true;
}

/** Dismiss the modal and forget what it was buying. */
export function closeBuyNow(): void {
	buyNowOpen.value = false;
	buyNowTarget.value = null;
}
// #endregion

// #region Host election
/** Where a Buy-Now modal instance is mounted. `lane` outranks `body`. */
export type BuyNowHost = "lane" | "body";

/** Lower wins. Fixed, so the elected host never depends on which island hydrated first. */
const HOST_RANK: Record<BuyNowHost, number> = { lane: 0, body: 1 };

const mountedHosts = signal<readonly BuyNowHost[]>([]);

/** The host currently responsible for rendering the panel, or `null` while none is mounted. */
export const buyNowHost = computed<BuyNowHost | null>(() => {
	let winner: BuyNowHost | null = null;
	for (const host of mountedHosts.value) {
		if (winner === null || HOST_RANK[host] < HOST_RANK[winner]) winner = host;
	}
	return winner;
});

/** Register a mounted host. Returns the de-registration callback an effect cleanup runs. */
export function registerBuyNowHost(host: BuyNowHost): () => void {
	mountedHosts.value = [...mountedHosts.value, host];
	return () => {
		const next = [...mountedHosts.value];
		const at = next.indexOf(host);
		if (at >= 0) next.splice(at, 1);
		mountedHosts.value = next;
	};
}
// #endregion
