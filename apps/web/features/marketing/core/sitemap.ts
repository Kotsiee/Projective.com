/**
 * sitemap — every public page a search engine should index, as sitemaps.org 0.9 documents
 * (`GET /sitemap.xml`, PUBLIC_ROUTES P8, Decisions #279 and #452). Pure: the route reads the sources
 * through their services and hands them here with the site's public origin.
 *
 * `/sitemap.xml` is a `<sitemapindex>` naming one `<urlset>` file per section and chunk, each at
 * `/sitemap.xml?section=<pages|listings|profiles>` (`&page=2` onward). A chunk holds at most
 * {@link SITEMAP_URL_LIMIT} URLs and {@link SITEMAP_BYTE_LIMIT} bytes. Every file shares the index's
 * root directory, which the sitemaps.org location rule requires of a file listing root-level pages,
 * and the files add no top-level route segment.
 *
 * What the `pages` section lists, and on whose rule:
 * - the home page, its features index (`/features`), Explore, `/about`, `/contact` and `/feedback`
 *   (no `lastmod`: nothing dates them);
 * - the help hub, every category with a visible article and every visible article — at its canonical
 *   `/help/<category>/<article>` path, last modified on the article's `updatedAt` (a category and the
 *   hub on the latest of theirs);
 * - `/changelog` and every visible release page, on its release day;
 * - `/articles` and every visible article, on its `updatedAt`;
 * - legal documents only once reviewed (`legal/core/sitemap.ts`) — today, none.
 *
 * The `listings` section lists every published service, product and member post at its canonical
 * `/view/:slug`, last modified on its row's `updated_at`. The `profiles` section lists every public
 * person, team and business at `/@handle`, with no `lastmod` because the directory dates no profile
 * change. Which rows qualify is `ExploreSitemapService`'s rule over the anonymous catalogue: never a
 * draft, paused or archived row, never anything an unlisted or private owner holds, and so never a
 * 13–17 account's (Decision #208).
 *
 * Not listed: filtered and later pages of a feed (a release or an article is listed at its own
 * address, which is what a filter or a page would lead to), the help search (`?q=`, `noindex`), the
 * feedback drawer (`?feedback=open`, disallowed in robots.txt), a single idea (its canonical is
 * `/feedback`), project briefs (they close once hired) and `/:handle/view/:slug` (its canonical is
 * `/view/:slug`).
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
import { canonicalViewPath } from "@features/view/core/view-canonical.ts";
import { SITEMAP_PATH } from "./robots.ts";

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

/** What the marketplace contributes (`ExploreSitemapService.sources`): qualifying rows only. */
export interface CatalogueSitemapSources {
	/** Published services, products and member posts by slug, with their row's `updated_at`. */
	listings: ReadonlyArray<{ slug: string; updatedAt: string }>;
	/** Public profiles by `@handle`. */
	profiles: ReadonlyArray<{ handle: string }>;
}

/** The sitemaps.org ceiling on URLs in one file, and on sitemaps in one index. */
export const SITEMAP_URL_LIMIT = 50_000;

/** The sitemaps.org ceiling on one file's uncompressed size: 50 MiB. */
export const SITEMAP_BYTE_LIMIT = 52_428_800;

/** How many URLs and bytes one `<urlset>` file may hold. */
export interface SitemapLimits {
	urls: number;
	bytes: number;
}

/** The sitemaps.org limits, which every served file keeps to. */
export const SITEMAP_LIMITS: SitemapLimits = { urls: SITEMAP_URL_LIMIT, bytes: SITEMAP_BYTE_LIMIT };

/** The index's sections, in the order it lists them. */
export const SITEMAP_SECTIONS = ["pages", "listings", "profiles"] as const;

/** One section of the sitemap. */
export type SitemapSection = typeof SITEMAP_SECTIONS[number];

/** Each section's entries, as the route read them; a section left out has no file. */
export type SitemapSectionEntries = Partial<Record<SitemapSection, readonly SitemapEntry[]>>;

/** One `<urlset>` file: its section, its 1-based page, its address and what it lists. */
export interface SitemapFile {
	section: SitemapSection;
	page: number;
	path: string;
	entries: readonly SitemapEntry[];
	lastmod?: string;
}

/** What a request to `/sitemap.xml` asks for. */
export type SitemapRequest =
	| { kind: "index" }
	| { kind: "file"; section: SitemapSection; page: number };
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
	return uniqueByPath(entries);
}

/** `entries` with no path listed twice (the first wins). */
function uniqueByPath(entries: readonly SitemapEntry[]): SitemapEntry[] {
	const seen = new Set<string>();
	return entries.filter((entry) => !seen.has(entry.path) && seen.add(entry.path));
}

/** Path order, so a chunk's boundaries move only as far as the list itself changes. */
function byPath(a: SitemapEntry, b: SitemapEntry): number {
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Every qualifying listing at its canonical `/view/:slug`, on its row's day, in path order. */
export function listingSitemapEntries(sources: CatalogueSitemapSources): SitemapEntry[] {
	return uniqueByPath(
		sources.listings.map((l) => ({ path: canonicalViewPath(l.slug), lastmod: day(l.updatedAt) })),
	).sort(byPath);
}

/** Every public profile at `/@handle`, in path order. */
export function profileSitemapEntries(sources: CatalogueSitemapSources): SitemapEntry[] {
	return uniqueByPath(
		sources.profiles.map((p) => ({ path: `/@${p.handle.replace(/^@/, "")}` })),
	).sort(byPath);
}
// #endregion

// #region Addresses
/**
 * What a `/sitemap.xml` query asks for: no parameter is the index; `section` (once, one of
 * {@link SITEMAP_SECTIONS}) with an optional `page` from 2 (digits, no leading zero) is one file.
 * Any other spelling (`page=1`, a repeated or unknown value, a `page` with no `section`) is `null`,
 * which the route answers 404: crawlers fetch only the addresses the index names.
 */
export function readSitemapRequest(params: URLSearchParams): SitemapRequest | null {
	const sections = params.getAll("section");
	const pages = params.getAll("page");
	if (sections.length === 0) return pages.length === 0 ? { kind: "index" } : null;
	if (sections.length > 1 || pages.length > 1) return null;
	const section = SITEMAP_SECTIONS.find((s) => s === sections[0]);
	if (!section) return null;
	if (pages.length === 0) return { kind: "file", section, page: 1 };
	if (!/^[1-9][0-9]{0,8}$/.test(pages[0]) || pages[0] === "1") return null;
	return { kind: "file", section, page: Number(pages[0]) };
}

/** The address of one file: `/sitemap.xml?section=…`, with `&page=…` from the second. */
export function sitemapFilePath(section: SitemapSection, page: number): string {
	const query = new URLSearchParams({ section });
	if (page > 1) query.set("page", String(page));
	return `${SITEMAP_PATH}?${query}`;
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

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const URLSET = { open: `<urlset xmlns="${SITEMAP_NS}">`, close: "</urlset>" };
const SITEMAPINDEX = { open: `<sitemapindex xmlns="${SITEMAP_NS}">`, close: "</sitemapindex>" };
const utf8 = new TextEncoder();

/** The UTF-8 size of `text`. */
function byteLength(text: string): number {
	return utf8.encode(text).length;
}

/** The origin with no trailing slash. */
function baseOf(origin: string): string {
	return origin.replace(/\/+$/, "");
}

/** One `<loc>` and its optional `<lastmod>`, absolute and escaped. */
function locAndLastmod(path: string, lastmod: string | undefined, base: string): string {
	const loc = `<loc>${escapeXml(new URL(path, `${base}/`).href)}</loc>`;
	return lastmod ? `${loc}<lastmod>${escapeXml(lastmod)}</lastmod>` : loc;
}

/** One `<url>` line of a `<urlset>`. */
function urlLine(entry: SitemapEntry, base: string): string {
	return `  <url>${locAndLastmod(entry.path, entry.lastmod, base)}</url>`;
}

/** A document: the declaration, the root's opening tag, one line each, the closing tag, a newline. */
function xmlDocument(root: { open: string; close: string }, lines: readonly string[]): string {
	return [XML_DECLARATION, root.open, ...lines, root.close, ""].join("\n");
}

/**
 * The sitemap document for `entries` on `origin` (the site's public origin; a trailing slash is
 * dropped). Each `<loc>` is the absolute, escaped URL; `<lastmod>` only where it is known. Throws past
 * {@link SITEMAP_URL_LIMIT} URLs or {@link SITEMAP_BYTE_LIMIT} bytes, which one file may not exceed
 * ({@link chunkSitemapEntries} keeps a section's files under both).
 */
export function buildSitemapXml(entries: readonly SitemapEntry[], origin: string): string {
	if (entries.length > SITEMAP_URL_LIMIT) {
		throw new RangeError(`A sitemap holds at most ${SITEMAP_URL_LIMIT} URLs (${entries.length}).`);
	}
	const base = baseOf(origin);
	const xml = xmlDocument(URLSET, entries.map((entry) => urlLine(entry, base)));
	const size = byteLength(xml);
	if (size > SITEMAP_BYTE_LIMIT) {
		throw new RangeError(`A sitemap holds at most ${SITEMAP_BYTE_LIMIT} bytes (${size}).`);
	}
	return xml;
}

/**
 * `entries` split into files, in order, each holding at most `limits.urls` URLs and serialising (on
 * `origin`) to at most `limits.bytes` bytes. No entries is no file. Throws when one URL alone cannot
 * fit a file.
 */
export function chunkSitemapEntries(
	entries: readonly SitemapEntry[],
	origin: string,
	limits: SitemapLimits = SITEMAP_LIMITS,
): SitemapEntry[][] {
	const base = baseOf(origin);
	const envelope = byteLength(xmlDocument(URLSET, []));
	const chunks: SitemapEntry[][] = [];
	let current: SitemapEntry[] = [];
	let size = envelope;
	for (const entry of entries) {
		const line = byteLength(urlLine(entry, base)) + 1;
		if (envelope + line > limits.bytes) {
			throw new RangeError(`${entry.path} cannot fit a ${limits.bytes}-byte sitemap.`);
		}
		if (current.length > 0 && (current.length >= limits.urls || size + line > limits.bytes)) {
			chunks.push(current);
			current = [];
			size = envelope;
		}
		current.push(entry);
		size += line;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

/**
 * Every file the index names, section by section in {@link SITEMAP_SECTIONS} order: each section's
 * entries chunked under `limits`, with the newest `lastmod` its entries carry. A section with no
 * entries has no file.
 */
export function sitemapFiles(
	sections: SitemapSectionEntries,
	origin: string,
	limits: SitemapLimits = SITEMAP_LIMITS,
): SitemapFile[] {
	return SITEMAP_SECTIONS.flatMap((section) =>
		chunkSitemapEntries(sections[section] ?? [], origin, limits).map((entries, i) => ({
			section,
			page: i + 1,
			path: sitemapFilePath(section, i + 1),
			entries,
			lastmod: latest(entries.flatMap((e) => (e.lastmod ? [e.lastmod] : []))),
		}))
	);
}

/**
 * The `<sitemapindex>` for `files` on `origin`: each file's absolute, escaped address and, where
 * known, its newest `lastmod`. Throws on no file (an index must name one) and past
 * {@link SITEMAP_URL_LIMIT} files.
 */
export function buildSitemapIndexXml(
	files: ReadonlyArray<Pick<SitemapFile, "path" | "lastmod">>,
	origin: string,
): string {
	if (files.length === 0 || files.length > SITEMAP_URL_LIMIT) {
		throw new RangeError(
			`A sitemap index names 1 to ${SITEMAP_URL_LIMIT} files (${files.length}).`,
		);
	}
	const base = baseOf(origin);
	return xmlDocument(
		SITEMAPINDEX,
		files.map((file) => `  <sitemap>${locAndLastmod(file.path, file.lastmod, base)}</sitemap>`),
	);
}
// #endregion
