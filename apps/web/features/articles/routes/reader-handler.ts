import { HttpError, page } from "fresh";
import { define } from "@web/utils/state.ts";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import { articleHref, isArticleSlug } from "../core/index-query.ts";
import { readFailureStatus } from "../core/read-status.ts";
import { articleJsonLdGraph, articleMeta } from "../core/article-seo.ts";

/**
 * `/articles/[slug]`'s handler (P6), kept apart from the page so it loads without an island under
 * `deno test`. Thin: shape-check the slug, ask the fat service, set the `<head>`.
 *
 * - A slug in the wrong case is a 308 to its lower-case spelling (slugs are stored lower-case).
 * - Anything that cannot be a slug, or names no visible article — never written, a draft, dated in
 *   the future, or retracted — is a 404, all alike, so a hidden article is never confirmed to exist.
 * - A failed read is the error page's status (503 when the content store is unreachable).
 *
 * Projective's articles live only here (Decision #271): member posts stay at `/view`, and neither
 * address redirects to the other.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.slug;
		const lower = slug.toLowerCase();
		if (lower !== slug && isArticleSlug(lower)) {
			return new Response(null, {
				status: 308,
				headers: { location: `${articleHref(lower)}${ctx.url.search}` },
			});
		}
		if (!isArticleSlug(slug)) throw new HttpError(404);
		const result = await EditorialArticlesBackendService.article(slug);
		if (!result.ok || !result.data) throw new HttpError(readFailureStatus(result.status));
		const origin = siteOrigin(ctx.url);
		applyPageMeta(ctx.state, articleMeta(result.data, origin));
		return page({
			page: result.data,
			signedIn: ctx.state.isAuthenticated ?? false,
			jsonLd: articleJsonLdGraph(result.data, origin),
		});
	},
});
