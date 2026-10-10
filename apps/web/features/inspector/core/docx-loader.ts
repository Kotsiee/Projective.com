/**
 * docx-loader — the only entry to {@link ./docx-runtime.ts | `docx-runtime`}. docx-preview and JSZip
 * load through one memoised dynamic import, so no island module graph (and so no server snapshot)
 * ever evaluates them. A failed import clears the memo so the next attempt can retry.
 */

/** The module namespace of the docx runtime. */
export type DocxRuntime = typeof import("./docx-runtime.ts");

let pending: Promise<DocxRuntime> | null = null;

/** Fetch (or re-use) the docx runtime. Call it only in the browser, from an effect. */
export function loadDocx(): Promise<DocxRuntime> {
	pending ??= import("./docx-runtime.ts").catch((error: unknown) => {
		pending = null;
		throw error;
	});
	return pending;
}
