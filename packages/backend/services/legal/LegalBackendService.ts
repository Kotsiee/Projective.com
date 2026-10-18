import type { LegalDoc } from "@projective/types/content";
import { renderPdf } from "../../core/pdf.ts";
import { ok, type ServiceResult } from "../ServiceResult.ts";
import { legalPdfBlocks, type LegalPdfOptions } from "./legal-pdf.ts";

// #region Types
/** A rendered legal PDF and the facts its response is cached by. */
export interface LegalPdf {
	/** `projective-terms-v2.0-draft.pdf`. */
	filename: string;
	bytes: Uint8Array<ArrayBuffer>;
	/**
	 * A strong validator: the document's slug, version and a hash of everything rendered from (the
	 * text, the review date, whether it is current). Any change to the document changes it.
	 */
	etag: string;
	/** Whether the version is still a draft (the response is `noindex` while it is). */
	draft: boolean;
}
// #endregion

// #region Cache
/** Rendered files by ETag. Six documents × a handful of versions × current-or-not: small and bounded. */
const RENDERED = new Map<string, LegalPdf>();
const RENDERED_MAX = 64;

/** FNV-1a (32-bit) of a string, as hex — a content fingerprint, not a security boundary. */
function fingerprint(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
// #endregion

/**
 * LegalBackendService — the server half of the legal surface (Decision #270).
 *
 * Legal documents are versioned TypeScript content modules in the app (`features/legal/core/content`),
 * not database rows (Decision #274 (A)), so this service is handed the resolved version by its route
 * and owns what is done with it: today, its PDF. The layout (`legal-pdf.ts`) and the writer
 * (`core/pdf.ts`) are pure; the service adds the file name, a content-derived ETag and an in-process
 * cache, so a document is rendered once per version and content rather than once per download.
 */
export const LegalBackendService = {
	/**
	 * One legal document version as a downloadable PDF: the version, the effective date, the draft
	 * disclosure while `reviewedAt` is unset, and every clause with its number and plain-English
	 * summary. Never fails for a valid document; it returns a {@link ServiceResult} so the route maps
	 * it like every other service call.
	 */
	documentPdf(doc: LegalDoc, opts: LegalPdfOptions): ServiceResult<LegalPdf> {
		const etag = `"legal-${doc.slug}-${doc.version}-${
			fingerprint(JSON.stringify({ doc, current: opts.current, canonical: opts.canonical }))
		}"`;
		const cached = RENDERED.get(etag);
		if (cached) return ok(cached);

		const draft = doc.reviewedAt === null;
		const rendered: LegalPdf = {
			filename: `projective-${doc.slug}-v${doc.version}${draft ? "-draft" : ""}.pdf`,
			bytes: renderPdf({
				title: `${doc.title} · Version ${doc.version}${draft ? " (draft)" : ""}`,
				blocks: legalPdfBlocks(doc, opts),
			}),
			etag,
			draft,
		};
		if (RENDERED.size >= RENDERED_MAX) RENDERED.delete(RENDERED.keys().next().value!);
		RENDERED.set(etag, rendered);
		return ok(rendered);
	},
};
