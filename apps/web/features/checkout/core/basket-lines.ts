import { signal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * basket-lines — the per-line control bindings the `/basket` body's fields are driven by.
 *
 * **Why this exists at all.** Every `@projective/ui` field takes a `Bindable`: a raw value makes the
 * control UNCONTROLLED (`useControllable` seeds an internal signal once and never looks at the prop
 * again), and a `Signal` makes it controlled. A basket row's controls have two writers — the row
 * itself, and the footer band's Select-all / bulk actions, which reach the same lines through the
 * shared store — so a raw value would leave a checkbox showing one thing while the basket it belongs
 * to believed another. The obvious alternatives are both worse: a native `<input>` opts the surface
 * out of the field contract (§C.1), and re-`key`ing the control on its own value forces a remount that
 * throws away keyboard focus the moment the reader toggles it.
 *
 * So each line gets one long-lived signal per control, and {@link syncLineStore} pushes the server's
 * answer back into them after every read. Two rules make that safe rather than a fight:
 *
 * - a line with a write IN FLIGHT is skipped, so an optimistic value is never overwritten by the read
 *   that is about to replace it;
 * - an email field the reader has TOUCHED is skipped, so a background refresh cannot delete a
 *   half-typed address out from under them.
 */

// #region Shape
/** The controlled bindings one basket line's fields read and write. */
export interface LineSignals {
	/** Selected-for-checkout — also written by the footer band's bulk selection. */
	selected: Signal<boolean>;
	/** Quantity (or seats, on a line that holds them). */
	quantity: Signal<number>;
	/** The delivery address for a digital deliverable, as typed. */
	email: Signal<string>;
	/**
	 * Whether the reader has typed in {@link email} since the last successful commit.
	 *
	 * It is the guard that stops a refetch clobbering an address mid-entry, which is why it is reset by
	 * the island on a successful write rather than on blur: until the server has the value, the
	 * reader's copy is the only one that exists.
	 */
	emailTouched: Signal<boolean>;
}

/** The island-owned map of line id → its control bindings. */
export type LineSignalStore = Map<string, LineSignals>;

/** Mint an empty store. Held in a ref by the body island, never at module scope. */
export function createLineStore(): LineSignalStore {
	return new Map();
}
// #endregion

// #region Access
/**
 * The bindings for a line, created on first sight.
 *
 * Safe to call during render: it constructs signals rather than calling hooks, so it does not care how
 * many rows are drawn or in what order.
 */
export function lineSignals(store: LineSignalStore, item: BasketItem): LineSignals {
	const existing = store.get(item.id);
	if (existing) return existing;
	const created: LineSignals = {
		selected: signal(item.isSelectedForCheckout),
		quantity: signal(item.quantity),
		email: signal(item.destinationEmail ?? ""),
		emailTouched: signal(false),
	};
	store.set(item.id, created);
	return created;
}
// #endregion

// #region Reconciliation
/** What {@link syncLineStore} needs to know beyond the lines themselves. */
export interface LineSyncOptions {
	/** The store's current view of a line's selection, optimistic overlay included. */
	selectedOf: (item: BasketItem) => boolean;
	/** Line ids with a write in flight; their bindings are left alone. */
	busy: ReadonlySet<string>;
}

/**
 * Push the server's answer back into the controls, and forget lines that are no longer in the basket.
 *
 * Called from an effect, never during render — writing a signal a component is subscribed to while it
 * renders is how a surface earns an infinite loop. Every write is guarded by a `peek()` comparison, so
 * a sync that changes nothing schedules nothing.
 */
export function syncLineStore(
	store: LineSignalStore,
	items: readonly BasketItem[],
	options: LineSyncOptions,
): void {
	const live = new Set<string>();

	for (const item of items) {
		live.add(item.id);
		const bindings = store.get(item.id);
		if (!bindings) continue;
		if (options.busy.has(item.id)) continue;

		const selected = options.selectedOf(item);
		if (bindings.selected.peek() !== selected) bindings.selected.value = selected;
		if (bindings.quantity.peek() !== item.quantity) bindings.quantity.value = item.quantity;

		if (!bindings.emailTouched.peek()) {
			const address = item.destinationEmail ?? "";
			if (bindings.email.peek() !== address) bindings.email.value = address;
		}
	}

	for (const id of [...store.keys()]) if (!live.has(id)) store.delete(id);
}
// #endregion
