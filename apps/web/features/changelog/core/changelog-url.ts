import { CHANGELOG_CATEGORIES, type ChangelogCategory } from "@projective/types/editorial";

/**
 * changelog-url.ts — the changelog's URL contract (P5, Decision #278): its paths, the anchor id of
 * a release on the feed, the feed's query (`?category=` repeatable, `?page=n`) and its one canonical
 * spelling, and a release address that tolerates a leading `v`.
 *
 * Server-side: it reads the category list from `@projective/types/editorial`, which carries Zod.
 * The lightbox island uses `./image-param.ts` instead.
 */

// #region Paths & anchors
/** The feed. */
export const CHANGELOG_PATH = "/changelog";

/** The RSS 2.0 feed. */
export const CHANGELOG_RSS_PATH = "/changelog/rss.xml";

/** A release's canonical page (`/changelog/0.12.0`). */
export function releasePath(version: string): string {
	return `${CHANGELOG_PATH}/${version}`;
}

/**
 * A release's anchor id on the feed: `v` + the version with every `.` turned into `-`
 * (`0.12.0` → `v0-12-0`, `1.0.0-rc.1` → `v1-0-0-rc-1`) — a valid, lower-case kebab anchor.
 */
export function releaseAnchorId(version: string): string {
	return `v${version.toLowerCase().replace(/\./g, "-")}`;
}

/** The feed address of a release: `/changelog#v0-12-0` (page 1, unfiltered). */
export function releaseFeedHref(version: string): string {
	return `${CHANGELOG_PATH}#${releaseAnchorId(version)}`;
}

/**
 * The version a `/changelog/<segment>` request names, and whether that spelling is canonical:
 * `0.12.0` is; `v0.12.0` and `V0.12.0` name the same release and redirect to it. Anything that is
 * not version-shaped is `null` (a 404 — the service decides whether the version exists).
 */
export function readVersionSegment(
	segment: string,
): { version: string; canonical: boolean } | null {
	const decoded = (() => {
		try {
			return decodeURIComponent(segment);
		} catch {
			return segment;
		}
	})();
	const m =
		/^[vV]?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/
			.exec(decoded);
	if (!m || m[1].length > 64) return null;
	const version = m[1].toLowerCase();
	return { version, canonical: segment === version };
}
// #endregion

// #region Feed query
/** The feed's query, parsed. */
export interface FeedQuery {
	/** Selected categories, distinct, in filter order. */
	categories: ChangelogCategory[];
	/** 1-based page. */
	page: number;
	/**
	 * The canonical `path?query#…` to redirect to when the request spelled the query another way (an
	 * unknown or repeated category, `page=1`, a malformed page, categories out of order); `null` when
	 * the request is already canonical. Parameters the feed does not own (`image`, `utm_*`) are kept.
	 */
	redirect: string | null;
}

/** A page number as written in a canonical URL: a positive integer, no sign, no leading zero. */
function readPage(raw: string | null): number | null {
	if (raw === null) return 1;
	return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : null;
}

/**
 * The canonical feed query string for `categories` and `page` (no leading `?`): categories in
 * filter order, page omitted when 1. Pass `extra` to append parameters the feed does not own.
 */
export function feedSearch(
	categories: readonly ChangelogCategory[],
	page: number,
	extra: ReadonlyArray<[string, string]> = [],
): string {
	const params = new URLSearchParams();
	for (const category of CHANGELOG_CATEGORIES) {
		if (categories.includes(category)) params.append("category", category);
	}
	if (page > 1) params.set("page", String(page));
	for (const [key, value] of extra) params.append(key, value);
	return params.toString().replace(/%3A/gi, ":");
}

/** The feed's href for a filter and page (`/changelog?category=escrow&page=2`). */
export function feedHref(categories: readonly ChangelogCategory[], page = 1): string {
	const search = feedSearch(categories, page);
	return search ? `${CHANGELOG_PATH}?${search}` : CHANGELOG_PATH;
}

/**
 * The href that toggles `category` in the current selection (added when absent, removed when
 * present), back on page 1 — a filter change always starts the list again.
 */
export function toggleCategoryHref(
	selected: readonly ChangelogCategory[],
	category: ChangelogCategory,
): string {
	const next = selected.includes(category)
		? selected.filter((c) => c !== category)
		: [...selected, category];
	return feedHref(next, 1);
}

/**
 * Parse the feed's query. Lenient on input (case-insensitive categories, unknown ones and repeats
 * dropped, a malformed page read as page 1) and strict on output: whenever the feed's own parameters
 * are not spelled the canonical way, {@link FeedQuery.redirect} names the URL that is. Parameters
 * the feed does not own are compared by value only, so their encoding never triggers a redirect.
 */
export function parseFeedQuery(url: URL): FeedQuery {
	const asked = url.searchParams.getAll("category").map((c) => c.trim().toLowerCase());
	const categories = CHANGELOG_CATEGORIES.filter((c) => asked.includes(c));
	const pages = url.searchParams.getAll("page");
	const read = pages.length === 1 ? readPage(pages[0]) : pages.length === 0 ? 1 : null;
	const page = read ?? 1;

	const owned = (key: string) => key === "category" || key === "page";
	const requested = [...url.searchParams].filter(([key]) => owned(key));
	const wanted = [...new URLSearchParams(feedSearch(categories, page))];
	const canonical = requested.length === wanted.length &&
		requested.every(([key, value], i) => key === wanted[i][0] && value === wanted[i][1]);
	if (canonical) return { categories, page, redirect: null };

	const extra = [...url.searchParams].filter(([key]) => !owned(key));
	const search = feedSearch(categories, page, extra);
	return {
		categories,
		page,
		redirect: `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
	};
}
// #endregion
