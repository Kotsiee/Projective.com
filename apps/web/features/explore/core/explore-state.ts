import type { ExploreCategory, ExploreParams, Facet } from "../types/explore-types.ts";
import { facetIsDefault } from "../types/explore-types.ts";
import {
	defaultExploreSort,
	EXPLORE_FACET_VALUE_MAX,
	EXPLORE_FACET_VALUES_MAX,
	EXPLORE_LIMIT_MAX,
	EXPLORE_OFFSET_MAX,
	EXPLORE_QUERY_MAX,
	ExploreParamsSchema,
	isExploreFacetKey,
	isExploreSort,
	resolveExploreSort,
} from "@projective/types/explore";

export type { ExploreParams };
/** The facet whitelist both doors parse against (the SSOT lives in `@projective/types/explore`). */
export { EXPLORE_FACET_KEYS } from "@projective/types/explore";

/**
 * Explore URL state — the single source of truth for which layout renders and how results are
 * filtered. Pure and DOM-free so it runs identically on the server (route handler picks State A vs B)
 * and the client (islands read/write it). No module-scope `globalThis` access.
 */

// #region Types
/** Which door a discovery query came through: the `/explore` page, or `GET /api/explore/search`. */
export type ExploreDoor = "page" | "api";

/** The keys the parser reads itself; every other key it reads is a facet (`EXPLORE_FACET_KEYS`). */
const QUERY_KEYS = new Set(["q", "category", "type", "sort"]);

/**
 * Keys `/explore` carries for other owners and never reads as facets: the open detail drawer
 * (`item`, `detail-nav.ts`), the settings and feedback overlays (`settings`, `feedback`, ROUTING.md),
 * and campaign tags (`utm_*`). The canonical redirect keeps them.
 */
const PAGE_KEYS = new Set(["item", "settings", "feedback"]);

/** The paging keys only `GET /api/explore/search` takes. */
const API_KEYS = new Set(["offset", "limit"]);

/** Whether `key` belongs to another owner on `door` (see {@link PAGE_KEYS} and {@link API_KEYS}). */
function isForeignKey(key: string, door: ExploreDoor): boolean {
	return door === "page" ? PAGE_KEYS.has(key) || key.startsWith("utm_") : API_KEYS.has(key);
}

/** A query parsed at a door: the bounded params, the API's paging, and what had to be corrected. */
export interface ExploreQuery {
	params: ExploreParams;
	/** The feed page's first item (the API only; `0` on the page). */
	offset: number;
	/** The feed page's size (the API only); `undefined` for the service's default. */
	limit: number | undefined;
	/**
	 * What the request held that the canonical query does not, by query key. Empty for a canonical
	 * query. The page redirects to the canonical query when it is not empty; the API answers 422.
	 */
	problems: Record<string, string>;
}

const CATEGORIES = new Set<ExploreCategory>([
	"all",
	"users",
	"freelancers",
	"teams",
	"businesses",
	"services",
	"projects",
	"products",
	"articles",
]);
// #endregion

// #region Parse
function toCategory(raw: string | null): ExploreCategory {
	if (!raw) return "all";
	const v = raw.toLowerCase() as ExploreCategory;
	return CATEGORIES.has(v) ? v : "all";
}

/** A paging value: a whole number in `min..max`, `null` when absent, `undefined` when out of bounds. */
function pagingValue(raw: string | null, min: number, max: number): number | null | undefined {
	if (raw === null) return null;
	const n = Number(raw);
	return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Parse a discovery query at a door (CAS S37) into bounded {@link ExploreParams} that
 * `ExploreParamsSchema` accepts, recording everything it had to correct:
 *
 * - `q` longer than `EXPLORE_QUERY_MAX` characters is cut to that length;
 * - an unknown `sort` or `category` falls back to the default;
 * - a key that is neither the parser's, another owner's on that door, nor one of `EXPLORE_FACET_KEYS`
 *   is dropped, so it never reaches the search or `search.query_logs`;
 * - a facet value over `EXPLORE_FACET_VALUE_MAX` characters is dropped, and a facet keeps at most
 *   `EXPLORE_FACET_VALUES_MAX` values;
 * - on the API, `offset` and `limit` must be whole numbers inside their bounds.
 *
 * Accepts both the canonical `?category=` and the legacy `?type=` the hero search historically
 * emitted. Facets accept repeated keys (`?stage=hiring&stage=live`) or comma lists
 * (`?roles=ios,android`). With no `?sort=`, a search with a query takes Best match and one without
 * takes Recommended.
 */
export function inspectExploreQuery(
	search: string | URLSearchParams,
	door: ExploreDoor = "page",
): ExploreQuery {
	const sp = typeof search === "string" ? new URLSearchParams(search) : search;
	const problems: Record<string, string> = {};
	const filters: Record<string, string[]> = {};
	for (const key of new Set(sp.keys())) {
		if (QUERY_KEYS.has(key) || isForeignKey(key, door)) continue;
		if (!isExploreFacetKey(key)) {
			problems[key] = "Not a filter of this search.";
			continue;
		}
		const given = sp.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
		let values = given.filter((v) => v.length <= EXPLORE_FACET_VALUE_MAX);
		if (values.length < given.length) {
			problems[key] = `A value is longer than ${EXPLORE_FACET_VALUE_MAX} characters.`;
		}
		if (values.length > EXPLORE_FACET_VALUES_MAX) {
			problems[key] = `At most ${EXPLORE_FACET_VALUES_MAX} values.`;
			values = values.slice(0, EXPLORE_FACET_VALUES_MAX);
		}
		if (values.length) filters[key] = values;
	}

	let q = (sp.get("q") ?? "").trim();
	if (q.length > EXPLORE_QUERY_MAX) {
		problems.q = `At most ${EXPLORE_QUERY_MAX} characters.`;
		q = q.slice(0, EXPLORE_QUERY_MAX).trim();
	}
	const categoryRaw = sp.get("category") ?? sp.get("type");
	const category = toCategory(categoryRaw);
	if (categoryRaw && category === "all" && categoryRaw.toLowerCase() !== "all") {
		problems.category = "Not a category.";
	}
	const sortRaw = sp.get("sort");
	if (sortRaw && !isExploreSort(sortRaw)) problems.sort = "Not an order.";

	let offset = 0;
	let limit: number | undefined;
	if (door === "api") {
		const o = pagingValue(sp.get("offset"), 0, EXPLORE_OFFSET_MAX);
		if (o === undefined) problems.offset = `A whole number from 0 to ${EXPLORE_OFFSET_MAX}.`;
		else if (o !== null) offset = o;
		const l = pagingValue(sp.get("limit"), 1, EXPLORE_LIMIT_MAX);
		if (l === undefined) problems.limit = `A whole number from 1 to ${EXPLORE_LIMIT_MAX}.`;
		else if (l !== null) limit = l;
	}

	const params: ExploreParams = { q, category, sort: resolveExploreSort(sortRaw, q), filters };
	// The SSOT has the last word: whatever the corrections above miss, the schema still refuses.
	const checked = ExploreParamsSchema.safeParse(params);
	if (!checked.success) {
		for (const issue of checked.error.issues) {
			const key = String(issue.path.at(-1) ?? "query");
			problems[key] ??= issue.message;
		}
	}
	return { params, offset, limit, problems };
}

/**
 * Parse a query string (or `URLSearchParams`) into normalised, bounded {@link ExploreParams}: the
 * page door of {@link inspectExploreQuery}, for callers that only need the params (islands reading
 * the URL, the related-terms route).
 */
export function parseExploreParams(search: string | URLSearchParams): ExploreParams {
	return inspectExploreQuery(search, "page").params;
}

/**
 * The canonical `/explore?…` address of a page query: {@link serializeExploreParams} of its corrected
 * params, then every key another owner carries on the page (`item`, `settings`, `feedback`, `utm_*`)
 * as it arrived. Where the page redirects a query that needed correcting.
 */
export function canonicalExploreHref(params: ExploreParams, arrived: URLSearchParams): string {
	const path = serializeExploreParams(params);
	const at = path.indexOf("?");
	const sp = new URLSearchParams(at === -1 ? "" : path.slice(at + 1));
	for (const [key, value] of arrived) {
		if (isForeignKey(key, "page")) sp.append(key, value);
	}
	const qs = sp.toString();
	return qs ? `/explore?${qs}` : "/explore";
}
// #endregion

// #region Serialise + derive
/**
 * Serialise {@link ExploreParams} back to a canonical `/explore?…` path (stable key order). `?sort=` is
 * written only when it differs from the query's default order.
 */
export function serializeExploreParams(p: ExploreParams): string {
	const sp = new URLSearchParams();
	if (p.q) sp.set("q", p.q);
	if (p.category && p.category !== "all") sp.set("category", p.category);
	const sort = resolveExploreSort(p.sort, p.q);
	if (sort !== defaultExploreSort(p.q)) sp.set("sort", sort);
	for (const [key, values] of Object.entries(p.filters)) {
		for (const v of values) sp.append(key, v);
	}
	const qs = sp.toString();
	return qs ? `/explore?${qs}` : "/explore";
}

/**
 * Immutably replace the free-text query. A sort that was the old query's default follows to the new
 * query's default (typing a first query lands on Best match); a sort the reader picked is kept.
 */
export function withQuery(p: ExploreParams, q: string): ExploreParams {
	const next = q.trim();
	const sort = p.sort === defaultExploreSort(p.q) ? defaultExploreSort(next) : p.sort;
	return { ...p, q: next, sort: resolveExploreSort(sort, next) };
}

/** Immutably set the order; a value that names no order resolves to the query's default. */
export function withSort(p: ExploreParams, sort: string): ExploreParams {
	return { ...p, sort: resolveExploreSort(sort, p.q) };
}

/**
 * Immutably set (or delete when empty) one facet's values on an {@link ExploreParams}. Shared by the
 * `SearchDashboard` island and the relocated filter lane so both mutate query state identically.
 */
export function withFilter(p: ExploreParams, id: string, values: string[]): ExploreParams {
	const filters = { ...p.filters };
	if (values.length) filters[id] = values;
	else delete filters[id];
	return { ...p, filters };
}

/**
 * The number of active facet selections — the sidebar's "active count" badge. Given the facet list,
 * a multi-choice facet counts each chosen option and a single-value facet (a range, a rating, a
 * milestone) counts once and only when it is off its default; without the list every carried value
 * counts, which is the URL's own view of the state.
 */
export function activeFilterCount(p: ExploreParams, facets?: readonly Facet[]): number {
	if (!facets) return Object.values(p.filters).reduce((n, arr) => n + arr.length, 0);
	const byId = new Map(facets.map((f) => [f.id, f] as const));
	let n = 0;
	for (const [id, values] of Object.entries(p.filters)) {
		const facet = byId.get(id);
		if (!facet) {
			n += values.length;
			continue;
		}
		if (facetIsDefault(facet, values)) continue;
		n += "options" in facet ? values.length : 1;
	}
	return n;
}

/**
 * State selector. Results mode (State B) is active when there is a free-text query OR an isolated
 * top-level category; otherwise the Home layout (State A) renders. A bare `?category=all` is Home.
 */
export function isResultsMode(p: ExploreParams): boolean {
	return p.q.length > 0 || p.category !== "all";
}

/**
 * Whether a single category is isolated — the trigger to swap the grouped "rows" feed for the unified
 * window-scrolled infinite feed. A free-text query with no category stays grouped across categories.
 */
export function isIsolatedCategory(p: ExploreParams): boolean {
	return p.category !== "all";
}
// #endregion
