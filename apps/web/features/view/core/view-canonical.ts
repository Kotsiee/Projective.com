import { type PageMeta, pageMeta } from "@features/marketing/core/seo.ts";

/**
 * view-canonical — one canonical address per listing page (Decision #452). `/view/:slug` and
 * `/:handle/view/:slug` render the same page, and both name `/view/:slug`, so a search engine indexes
 * it once and the sitemap lists the address the page itself declares.
 *
 * @module
 */

/** The canonical path of a listing page: `/view/:slug`, no query. */
export function canonicalViewPath(slug: string): string {
	return `/view/${encodeURIComponent(slug)}`;
}

/** A listing page's head (title, description, canonical, Open Graph) on the site's public `origin`. */
export function viewPageMeta(
	item: { id: string; title: string; summary: string },
	origin: string,
): PageMeta {
	return pageMeta({
		title: item.title,
		description: item.summary,
		path: canonicalViewPath(item.id),
		origin,
	});
}
