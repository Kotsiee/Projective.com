/// <reference lib="dom" />
import { computed, signal } from "@preact/signals";

/**
 * files-history — where the folder in view sits in this visit's browser history, which is what the
 * crumb bar's Back and Forward can honestly offer: Back stops at the folder the hub opened on rather
 * than walking out of `/files`, and Forward exists only after a Back.
 *
 * Each entry carries its index, so a `popstate` can say where it landed. Every entry is stamped
 * `fClientNav: false` and the hub's first one is re-stamped on mount: Fresh's runtime reloads the
 * document on a `popstate` into any other (the recipe `feedback-history.ts` documents).
 */

/** The folder in view, and the furthest entry still ahead of it. */
const position = signal({ index: 0, top: 0 });

/** Whether Back stays in this visit to the hub. */
export const canGoBack = computed(() => position.value.index > 0);

/** Whether an entry lies ahead of the folder in view. */
export const canGoForward = computed(() => position.value.index < position.value.top);

function indexOfEntry(): number {
	const state = history.state as { fhIndex?: unknown } | null;
	return typeof state?.fhIndex === "number" ? state.fhIndex : 0;
}

/** Adopt the entry the hub opened on, so Back into it stays in this document. */
export function pinFilesEntry(): void {
	const index = indexOfEntry();
	history.replaceState({ ...history.state, fClientNav: false, fhIndex: index }, "");
	position.value = { index, top: index };
}

/** Push a folder's address. Whatever lay ahead is gone, as it is in the browser's own stack. */
export function pushFilesEntry(href: string): void {
	const index = position.value.index + 1;
	history.pushState({ fClientNav: false, fhIndex: index }, "", href);
	position.value = { index, top: index };
}

/** Read where a Back or Forward landed. */
export function syncFilesEntry(): void {
	const index = indexOfEntry();
	position.value = { index, top: Math.max(position.value.top, index) };
}
