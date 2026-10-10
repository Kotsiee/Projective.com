/**
 * markdown-loader — the one entry to `markdown-runtime.ts` (marked + DOMPurify + the highlighter),
 * which reads `window` and so must stay behind a dynamic import. Memoised; cleared on failure.
 */

/** The markdown runtime's module namespace. */
export type MarkdownRuntime = typeof import("./markdown-runtime.ts");

let pending: Promise<MarkdownRuntime> | null = null;

/** Fetch (or re-use) the markdown runtime. */
export function loadMarkdown(): Promise<MarkdownRuntime> {
	pending ??= import("./markdown-runtime.ts").catch((error: unknown) => {
		pending = null;
		throw error;
	});
	return pending;
}
