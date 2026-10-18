import { HttpError } from "fresh";
import { define } from "@web/utils/state.ts";
import { LegalBackendService } from "@server/services/legal/LegalBackendService.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { canonicalUrl } from "@features/marketing/core/seo.ts";
import { legalToday } from "../../core/registry.ts";
import { resolveLegalPdf } from "../../core/view.ts";
import { legalDocumentHref } from "../../core/versions.ts";

/** A public legal PDF may be cached briefly; the ETag revalidates it against the content. */
const CACHE_CONTROL = "public, max-age=3600, must-revalidate";

/**
 * `/legal/:slug/pdf` (`?v=<version>`) — a legal document version as a PDF download (Decision #270),
 * re-exported by `routes/(public)/legal/[slug]/pdf.ts`. Thin controller: resolve the version (an
 * unknown document or version is a 404), hand it to {@link LegalBackendService.documentPdf}, and
 * answer the file as an attachment — validated by a content ETag (a matching `If-None-Match` is a
 * `304`), and `noindex` while the version is a draft, as the page is (owner ruling (e)).
 */
export const handler = define.handlers({
	GET(ctx) {
		const request = resolveLegalPdf(ctx.params.slug, ctx.url.searchParams, legalToday());
		if (request.kind === "not-found") throw new HttpError(404);
		const canonical = canonicalUrl(siteOrigin(ctx.url), legalDocumentHref(request.doc.slug));
		const result = LegalBackendService.documentPdf(request.doc, {
			current: request.current,
			canonical,
		});
		if (!result.ok || !result.data) {
			return Response.json({ ok: false, message: result.message }, { status: result.status });
		}
		const pdf = result.data;
		const headers: Record<string, string> = {
			etag: pdf.etag,
			"cache-control": CACHE_CONTROL,
			"x-content-type-options": "nosniff",
			...(pdf.draft ? { "x-robots-tag": "noindex" } : {}),
		};
		if (ctx.req.headers.get("if-none-match") === pdf.etag) {
			return new Response(null, { status: 304, headers });
		}
		return new Response(pdf.bytes, {
			status: 200,
			headers: {
				...headers,
				"content-type": "application/pdf",
				"content-disposition": `attachment; filename="${pdf.filename}"`,
			},
		});
	},
});
