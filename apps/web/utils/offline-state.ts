import { signal } from "@preact/signals";

/**
 * offline-state — the two things the offline guards need to tell the page, as shared signals.
 *
 * The guards (`offline-guards.ts`, beside this file) run outside any component: one is a `document`
 * click listener, the other wraps `globalThis.fetch`. Neither can render, so they write here and the
 * `OfflineBridge` island — the one hydration root that owns the interstitial and the notice stack —
 * reads and draws.
 * A module signal rather than a context for the same reason every cross-island bridge in this app is
 * one: a `BodyPortal`ed dialog and a `document`-level listener are not in any provider's subtree.
 */

// #region Blocked navigation
/**
 * The internal destination the navigation guard refused because nothing is stored for it, or `null`
 * while no interstitial is due. Set by the guard, cleared by the dialog's dismissal.
 */
export const blockedNavigation = signal<URL | null>(null);

/**
 * Whether the interstitial is open — a boolean twin of {@link blockedNavigation}, because the shared
 * `Dialog` binds a `Signal<boolean>` (controlled) and writes `false` into it when the reader closes
 * it from the header, the footer or Escape. The two are kept in step by the two functions below and
 * nowhere else.
 */
export const offlineModalOpen = signal<boolean>(false);

/** Refuse a navigation: record where the reader was going so the interstitial can open. */
export function refuseNavigation(dest: URL): void {
	blockedNavigation.value = dest;
	offlineModalOpen.value = true;
}

/** The reader dismissed the interstitial. */
export function dismissBlockedNavigation(): void {
	offlineModalOpen.value = false;
	blockedNavigation.value = null;
}
// #endregion

// #region Refused writes
/** One refused write, as the island receives it. */
export interface WriteRefusal {
	/** The sentence to show. */
	message: string;
	/** When it happened — a monotonic-enough clock for the de-duplication window. */
	at: number;
}

/**
 * The most recent refused user-facing write, or `null` before the first.
 *
 * Only the LATEST is kept, deliberately: a surface that fires three writes in a burst (an auto-save
 * plus two blur commits) owes the reader one sentence, not three, and the island de-duplicates on
 * the timestamp rather than this module counting.
 */
export const lastWriteRefusal = signal<WriteRefusal | null>(null);

/** Record that a write was refused because the browser is offline. */
export function reportWriteRefused(message: string, now: number = Date.now()): void {
	lastWriteRefusal.value = { message, at: now };
}
// #endregion
