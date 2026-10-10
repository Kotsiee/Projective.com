/**
 * highlight-loader — the one entry to `highlight-runtime.ts`, which must stay behind a dynamic
 * import (Fresh's server snapshot evaluates every island module, and the grammars are per-file
 * chunks). The promise is memoised and cleared on failure, so a transient network error can be
 * retried by the next canvas instead of poisoning the page.
 */

/** The highlighter runtime's module namespace. */
export type HighlightRuntime = typeof import("./highlight-runtime.ts");

let pending: Promise<HighlightRuntime> | null = null;

/** Fetch (or re-use) the highlighter runtime. */
export function loadHighlighter(): Promise<HighlightRuntime> {
	pending ??= import("./highlight-runtime.ts").catch((error: unknown) => {
		pending = null;
		throw error;
	});
	return pending;
}
