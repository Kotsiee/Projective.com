import type { ExploreCategory, ExploreParams, Facet } from "../types/explore-types.ts";
import { facetIsDefault } from "../types/explore-types.ts";

export type { ExploreParams };

/**
 * Explore URL state — the single source of truth for which layout renders and how results are
 * filtered. Pure and DOM-free so it runs identically on the server (route handler picks State A vs B)
 * and the client (islands read/write it). No module-scope `globalThis` access.
 */

// #region Types
/** Reserved keys owned by the parser; everything else is treated as an adaptive filter facet. */
const RESERVED = new Set(["q", "category", "type", "sort"]);

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

/** The default sort — "Recommended" (PRODUCT_SPEC §Reputation & Discovery ranking). */
export const DEFAULT_SORT = "recommended";
// #endregion

// #region Parse
function toCategory(raw: string | null): ExploreCategory {
	if (!raw) return "all";
	const v = raw.toLowerCase() as ExploreCategory;
	return CATEGORIES.has(v) ? v : "all";
}

/**
 * Parse a query string (or `URLSearchParams`) into normalised {@link ExploreParams}. Accepts both the
 * canonical `?category=` and the legacy `?type=` the hero search historically emitted. Filter facets
 * accept repeated keys (`?stage=hiring&stage=live`) or comma lists (`?roles=ios,android`).
 */
export function parseExploreParams(search: string | URLSearchParams): ExploreParams {
	const sp = typeof search === "string" ? new URLSearchParams(search) : search;
	const filters: Record<string, string[]> = {};
	for (const key of new Set(sp.keys())) {
		if (RESERVED.has(key)) continue;
		const values = sp.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(
			Boolean,
		);
		if (values.length) filters[key] = values;
	}
	return {
		q: (sp.get("q") ?? "").trim(),
		category: toCategory(sp.get("category") ?? sp.get("type")),
		sort: sp.get("sort") ?? DEFAULT_SORT,
		filters,
	};
}
// #endregion

// #region Serialise + derive
/** Serialise {@link ExploreParams} back to a canonical `/explore?…` path (stable key order). */
export function serializeExploreParams(p: ExploreParams): string {
	const sp = new URLSearchParams();
	if (p.q) sp.set("q", p.q);
	if (p.category && p.category !== "all") sp.set("category", p.category);
	if (p.sort && p.sort !== DEFAULT_SORT) sp.set("sort", p.sort);
	for (const [key, values] of Object.entries(p.filters)) {
		for (const v of values) sp.append(key, v);
	}
	const qs = sp.toString();
	return qs ? `/explore?${qs}` : "/explore";
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
