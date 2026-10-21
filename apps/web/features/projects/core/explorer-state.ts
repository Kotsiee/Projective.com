import { signal } from "@preact/signals";
import type { FileSortDir } from "../types/projects-types.ts";

/**
 * explorer-state — the File Explorer's and the Submissions explorer's query intent, shared between the
 * body and the middle-nav header band (Decision #317).
 *
 * On a route whose header band is free (`/projects/{project}/files`, `/projects/{project}/submissions`)
 * the band carries the folder in view's title and the toolbar — search · type · sort — while the body
 * owns the data. The two are separate hydration roots, so they share this module, the `files-state`
 * pattern: the toolbar writes intent here and calls {@link commitExplorer}; **the body is the single
 * fetch owner**, registered through {@link registerExplorer}. Where the band belongs to a channel or a
 * conversation, the body draws the same toolbar above its grid against the same signals.
 *
 * Module-level, so per-PROCESS on the server: nothing on the SSR path writes them. The body seeds the
 * title and resets everything on unmount, in the browser.
 */

// #region Intent
/** Free-text filename match. */
export const explorerQuery = signal("");
/** The column the listing is ordered on; `""` is the third sort state (the server's default order). */
export const explorerSortKey = signal<string>("date");
export const explorerSortDir = signal<FileSortDir>("desc");
/** Restrict to these kinds (the Attachment-Types filter); empty = every kind. */
export const explorerKinds = signal<string[]>([]);
/** The folder in view's title, once the body has published one; the band paints its SSR title until then. */
export const explorerTitle = signal<string | null>(null);
// #endregion

// #region Commit seam
const commitSeam = signal<(() => void) | null>(null);

/**
 * The body registers its re-read; the returned disposer unregisters it and resets the intent, so the
 * next explorer mounted in this tab starts from the defaults rather than the last one's search.
 */
export function registerExplorer(reload: () => void): () => void {
	commitSeam.value = reload;
	return () => {
		if (commitSeam.value === reload) commitSeam.value = null;
		resetExplorerState();
	};
}

/** Ask the body to re-read. A no-op before it hydrates — the SSR paint is already correct. */
export function commitExplorer(): void {
	commitSeam.value?.();
}

/** Every signal back to its initial value. */
export function resetExplorerState(): void {
	explorerQuery.value = "";
	explorerSortKey.value = "date";
	explorerSortDir.value = "desc";
	explorerKinds.value = [];
	explorerTitle.value = null;
}
// #endregion
