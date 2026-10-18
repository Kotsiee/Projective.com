/**
 * The site's search-scope vocabulary — the one list every search selector offers (the header,
 * the Explore hero and results bar, the authenticated shell's search and the results drawer), so
 * each selector and its `/explore?category=` navigation stay in lockstep.
 */

// #region Search
/**
 * The canonical search scopes offered by the hero, header, and `/explore` search selectors. Single
 * source so every search surface stays in lockstep. Each scope carries the `/explore?category=` token
 * it navigates to (`all` is the neutral default — no category filter). "Freelancers" (the
 * service-providing identities) and "People" (individual members) are deliberately distinct scopes.
 * Order is the product-approved order.
 */
export const SEARCH_SCOPES = [
	{ value: "all", label: "All" },
	{ value: "freelancers", label: "Freelancers & Teams" },
	{ value: "users", label: "People & Businesses" },
	{ value: "services", label: "Services" },
	{ value: "products", label: "Products" },
	{ value: "projects", label: "Projects" },
	{ value: "articles", label: "Articles" },
] as const;

/** A search-scope token (the `/explore?category=` value each selector option navigates to). */
export type SearchScope = typeof SEARCH_SCOPES[number]["value"];

/** The default resting scope for every search selector — the neutral "All". */
export const DEFAULT_SEARCH_SCOPE: SearchScope = "all";

/** Resolve a scope token to its human label (unknown → the default scope's label). */
export function searchScopeLabel(value: string): string {
	return SEARCH_SCOPES.find((s) => s.value === value)?.label ??
		SEARCH_SCOPES.find((s) => s.value === DEFAULT_SEARCH_SCOPE)!.label;
}
// #endregion
