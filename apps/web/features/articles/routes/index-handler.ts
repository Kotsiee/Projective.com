import { HttpError, page } from "fresh";
import { define } from "@web/utils/state.ts";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import { parseArticleIndexQuery } from "../core/index-query.ts";
import { readFailureStatus } from "../core/read-status.ts";
import { articlesIndexJsonLd, articlesIndexMeta } from "../core/article-seo.ts";

/**
 * `/articles`' handler (P6), kept apart from the page so it loads without an island under
 * `deno test`. Thin: read the URL contract, ask the fat service, set the `<head>`.
 *
 * - A query in a non-canonical spelling (an unknown or repeated topic, `page=1`, a malformed page)
 *   is a 308 to the canonical one, so every filter state has one address.
 * - A page past the last is a 404; nothing matching is page 1 with an empty state.
 * - A failed read is the error page's status (503 when the content store is unreachable).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const query = parseArticleIndexQuery(ctx.url.searchParams);
		if (query.changed) {
			return new Response(null, { status: 308, headers: { location: `/articles${query.search}` } });
		}
		const result = await EditorialArticlesBackendService.index({
			topics: query.topics,
			page: query.page,
		});
		if (!result.ok || !result.data) throw new HttpError(readFailureStatus(result.status));
		const origin = siteOrigin(ctx.url);
		applyPageMeta(ctx.state, articlesIndexMeta(result.data, origin));
		return page({ index: result.data, jsonLd: articlesIndexJsonLd(result.data, origin) });
	},
});
