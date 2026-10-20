/**
 * sitemap — every public page a search engine should index, as a sitemaps.org 0.9 `<urlset>`
 * (`GET /sitemap.xml`, PUBLIC_ROUTES P8, Decision #279). Pure: the route reads the sources through
 * their services and hands them here with the site's public origin.
 *
 * What is listed, and on whose rule:
 * - the home page, its features index (`/features`), Explore, `/about`, `/contact` and `/feedback`
 *   (no `lastmod`: nothing dates them);
 * - the help hub, every category with a visible article and every visible article — at its canonical
 *   `/help/<category>/<article>` path, last modified on the article's `updatedAt` (a category and the
 *   hub on the latest of theirs);
 * - `/changelog` and every visible release page, on its release day;
 * - `/articles` and every visible article, on its `updatedAt`;
 * - legal documents only once reviewed (`legal/core/sitemap.ts`) — today, none.
 *
 * Not listed: filtered and later pages of a feed (a release or an article is listed at its own
 * address, which is what a filter or a page would lead to), the help search (`?q=`, `noindex`), the
 * feedback drawer (`?feedback=open`, disallowed in robots.txt) and a single idea (its canonical is
 * `/feedback`), drafts, profiles and listings (member content, behind their own visibility rules —
 * flagged in Decision #279 for a sitemap index of their own).
 *
 * @module
 */
import {
	HELP_ROOT,
	helpArticlePath,
	helpCategoryPath,
} from "@server/services/editorial/help-library.ts";
import { CHANGELOG_PATH, releasePath } from "@features/changelog/core/changelog-url.ts";
import { articleHref } from "@features/articles/core/index-query.ts";

// #region Types
/** One `<url>`: a site-relative path and, when known, the date it last changed (`YYYY-MM-DD`). */
export interface SitemapEntry {
	path: string;
	lastmod?: string;
}

/** What the editorial surfaces contribute, as their services read them (visible rows only). */
export interface SitemapSources {
	/** The help centre's non-empty topics, in hub order, with their visible articles. */
	help: ReadonlyArray<{
		category: { slug: string };
		articles: ReadonlyArray<{ category: string; slug: string; updatedAt: string }>;
	}>;
	/** Every visible changelog release. */
	releases: ReadonlyArray<{ version: string; releasedOn: string }>;
	/** Every visible Projective article. */
	articles: ReadonlyArray<{ slug: string; updatedAt: string }>;
	/** The legal pages that may be indexed (`legalSitemapEntries`). */
	legal: readonly SitemapEntry[];
}

/** The sitemaps.org ceiling for one file; past it the route must split into a sitemap index. */
export const SITEMAP_URL_LIMIT = 50_000;
// #endregion

// #region Entries
/** The public pages with no content source behind them. */
export const STATIC_SITEMAP_PATHS: readonly string[] = [
	"/",
	"/features",
	"/explore",
	"/about",
	"/contact",
	"/feedback",
];

/** A date or date-time as the `YYYY-MM-DD` a `<lastmod>` carries. */
function day(value: string): string {
	return value.slice(0, 10);
}

/** The latest of some dates, or `undefined` for none. */
function latest(values: readonly string[]): string | undefined {
	return values.length === 0 ? undefined : values.map(day).sort().at(-1);
}

/**
 * Every entry, in a stable reading order — the static pages, help, the changelog, the articles, then
 * legal — with no path listed twice (the first wins).
 */
export function sitemapEntries(sources: SitemapSources): SitemapEntry[] {
	const helpArticles = sources.help.flatMap((topic) => topic.articles);
	const entries: SitemapEntry[] = [
		...STATIC_SITEMAP_PATHS.map((path) => ({ path })),
		{ path: HELP_ROOT, lastmod: latest(helpArticles.map((a) => a.updatedAt)) },
		...sources.help.flatMap((topic) => [
			{
				path: helpCategoryPath(topic.category.slug),
				lastmod: latest(topic.articles.map((a) => a.updatedAt)),
			},
			...topic.articles.map((a) => ({ path: helpArticlePath(a), lastmod: day(a.updatedAt) })),
		]),
		{ path: CHANGELOG_PATH, lastmod: latest(sources.releases.map((r) => r.releasedOn)) },
		...sources.releases.map((r) => ({ path: releasePath(r.version), lastmod: day(r.releasedOn) })),
		{ path: "/articles", lastmod: latest(sources.articles.map((a) => a.updatedAt)) },
		...sources.articles.map((a) => ({ path: articleHref(a.slug), lastmod: day(a.updatedAt) })),
		...sources.legal,
	];
	const seen = new Set<string>();
	return entries.filter((entry) => !seen.has(entry.path) && seen.add(entry.path));
}
// #endregion

// #region The document
/** Escape a value for XML character data (`&`, `<`, `>`, `'`, `"`). */
export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/'/g, "&apos;")
		.replace(/"/g, "&quot;");
}

/**
 * The sitemap document for `entries` on `origin` (the site's public origin; a trailing slash is
 * dropped). Each `<loc>` is the absolute, escaped URL; `<lastmod>` only where it is known. Throws past
 * {@link SITEMAP_URL_LIMIT}, which a single file may not exceed.
 */
export function buildSitemapXml(entries: readonly SitemapEntry[], origin: string): string {
	if (entries.length > SITEMAP_URL_LIMIT) {
		throw new RangeError(`A sitemap holds at most ${SITEMAP_URL_LIMIT} URLs (${entries.length}).`);
	}
	const base = origin.replace(/\/+$/, "");
	const urls = entries.map((entry) => {
		const loc = `<loc>${escapeXml(new URL(entry.path, `${base}/`).href)}</loc>`;
		const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "";
		return `  <url>${loc}${lastmod}</url>`;
	});
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		"</urlset>",
		"",
	].join("\n");
}
// #endregion
