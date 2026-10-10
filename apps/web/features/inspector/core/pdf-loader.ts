/// <reference lib="dom" />
/**
 * pdf-loader — the one door to pdf.js. The engine reads `document`/`window` while it evaluates, and
 * Fresh's server snapshot evaluates every island module, so it is only ever reached through this
 * memoised dynamic import, from a browser effect or {@link warmPdfRuntime} during render.
 */

/** The PDF runtime: pdf.js with its worker and vendored decoders wired up. */
export type PdfRuntime = typeof import("./pdf-runtime.ts");

let pending: Promise<PdfRuntime> | null = null;

/** Fetch (or re-use) the PDF runtime. A failed import clears the memo so the next mount can retry. */
export function loadPdfRuntime(): Promise<PdfRuntime> {
	pending ??= import("./pdf-runtime.ts").catch((error: unknown) => {
		pending = null;
		throw error;
	});
	return pending;
}

/**
 * Start the fetch without waiting for it; a no-op on the server. The mount effect awaits
 * {@link loadPdfRuntime} for real and reports a failure there, so this head start only notes one.
 */
export function warmPdfRuntime(): void {
	if (typeof document === "undefined") return;
	loadPdfRuntime().catch(() => {
		pending = null;
	});
}
