import {
	ARTICLES,
	BUSINESSES,
	CTAS,
	FREELANCERS,
	HELP_ARTICLES,
	PRODUCTS,
	PROJECTS,
	SERVICES,
	SPONSORED,
	TEAMS,
	USERS,
} from "./fixtures.ts";
import { parsePriceMajor, PIPELINE_LOW } from "./pricing.ts";
import type {
	ExploreEntity,
	ExploreItem,
	ExploreParams,
	HomeFeed,
	ResultGroup,
} from "@projective/types/explore";

/**
 * Explore — pure discovery selectors (server side).
 *
 * The in-memory query behind {@link ExploreBackendService}: filter + sort the corpus, fold it into the
 * merged Search-Results sections, look items up, and page a stub pool for the infinite feed. Pure and
 * deterministic (no RNG, SSR/resume-safe) so it swaps cleanly for the ranking service later.
 */

// #region Derived pricing (numeric — for sorting/filtering)
/** Lowest active linked-service price with statistical outliers trimmed via the IQR fence. */
export function lowestActivePrice(prices: number[]): number | null {
	if (prices.length === 0) return null;
	if (prices.length < 4) return Math.min(...prices);
	const s = [...prices].sort((a, b) => a - b);
	const quantile = (p: number): number => {
		const i = (s.length - 1) * p;
		const lo = Math.floor(i);
		const hi = Math.ceil(i);
		return s[lo] + (s[hi] - s[lo]) * (i - lo);
	};
	const q1 = quantile(0.25);
	const q3 = quantile(0.75);
	const fence = q1 - 1.5 * (q3 - q1);
	const kept = s.filter((v) => v >= fence);
	return kept.length ? kept[0] : s[0];
}
// #endregion

// #region Corpus
/** Every item across every entity — the corpus `getResults` queries. */
export function allItems(): ExploreItem[] {
	return [
		...USERS,
		...FREELANCERS,
		...TEAMS,
		...BUSINESSES,
		...SERVICES,
		...PROJECTS,
		...PRODUCTS,
		...ARTICLES,
	];
}

/**
 * The Home discovery feed — sections keyed by format, plus the reserved promos.
 *
 * The format sections stay in fixture declaration order (that ordering is editorial — a curated
 * shelf), while `recommended` is genuinely ranked, through the same {@link rankRecommended} the
 * search path's default sort uses. Two orderings of the same corpus is the point: a shelf and a
 * ranking answer different questions, and collapsing them would make one of the two a lie.
 */
export function homeFeed(): HomeFeed {
	return {
		users: USERS,
		freelancers: FREELANCERS,
		teams: TEAMS,
		businesses: BUSINESSES,
		services: SERVICES,
		projects: PROJECTS,
		products: PRODUCTS,
		articles: ARTICLES,
		sponsored: SPONSORED,
		helpArticles: HELP_ARTICLES,
		ctas: CTAS,
		recommended: {
			services: rankRecommended(SERVICES),
			products: rankRecommended(PRODUCTS),
			projects: rankRecommended(PROJECTS),
			// "People who can help" is Home's own existing precedent for the talent scope — the same
			// freelancers-and-teams fold `CATEGORY_TYPES.freelancers` applies on the search path.
			people: rankRecommended([...FREELANCERS, ...TEAMS]),
		},
	};
}
// #endregion

// #region Query
/** The best rating track available on an item (helper preferred) — used by the "Top rated" sort. */
function topScore(item: ExploreItem): number {
	return Math.max(item.rating?.asHelper?.value ?? 0, item.rating?.asClient?.value ?? 0);
}

/**
 * The `recommended` ordering: verified owners first, then by best rating track.
 *
 * A marketplace-wide quality heuristic, not a personalisation — nothing here reads a viewer, because
 * neither this module nor {@link homeFeed} is given one. Exported so the Home feed's Recommended
 * lists and a `?sort=recommended` search rank through one comparator: two copies of "what we put
 * forward" would eventually disagree, and the disagreement would show up as the same corpus ordered
 * two ways on two surfaces a reader moves between in one click.
 */
export function compareRecommended(a: ExploreItem, b: ExploreItem): number {
	return (Number(b.owner.verified ?? false) - Number(a.owner.verified ?? false)) ||
		(topScore(b) - topScore(a));
}

/**
 * Rank a list by {@link compareRecommended}, returning a copy. Generic over the element type so a
 * caller holding a narrowed list (`ServiceItem[]`, `ProfileItem[]`) gets that type back rather than
 * a widened `ExploreItem[]` it would then have to re-narrow.
 */
export function rankRecommended<T extends ExploreItem>(items: readonly T[]): T[] {
	return [...items].sort(compareRecommended);
}

/** Parse a leading price out of a formatted string / derived floor for the "price" sort. */
function priceValue(item: ExploreItem): number {
	if (item.type === "services") {
		// Sort a pipeline by its low-intensity ticket floor (0.5×) and a session by its per-session
		// price, so the range/unit pricing shown on the card orders consistently.
		if (item.serviceType === "Pipeline" && item.ticketPrice) return item.ticketPrice * PIPELINE_LOW;
		// Session (per-session) and Group Session (per-seat) both order by their per-slot price.
		if (
			(item.serviceType === "Session" || item.serviceType === "Group Session") && item.sessionPrice
		) return item.sessionPrice;
		return parsePriceMajor(item.price);
	}
	if (item.type === "products") {
		return parsePriceMajor(item.price);
	}
	if (item.type === "freelancers" && item.servicePrices?.length) {
		return lowestActivePrice(item.servicePrices) ?? 0;
	}
	return Number.POSITIVE_INFINITY;
}

/**
 * Sibling entity types folded into a merged scope. "Freelancers & Teams" and "People & Businesses"
 * are single split-talent scopes, so those tokens match both members (the narrower `teams` /
 * `businesses` tokens stay singular).
 */
const CATEGORY_TYPES: Partial<Record<ExploreParams["category"], ExploreEntity[]>> = {
	freelancers: ["freelancers", "teams"],
	users: ["users", "businesses"],
};

/** Whether an item belongs to a selected top-level category (`all` matches everything). */
function inCategory(item: ExploreItem, category: ExploreParams["category"]): boolean {
	if (category === "all") return true;
	return (CATEGORY_TYPES[category] ?? [category]).includes(item.type);
}

function matchesQuery(item: ExploreItem, q: string): boolean {
	if (!q) return true;
	const hay = [
		item.title,
		item.owner.name,
		item.owner.handle,
		item.summary,
		...item.skills.map((s) => s.label),
	].join(" ").toLowerCase();
	return q.toLowerCase().split(/\s+/).every((term) => hay.includes(term));
}

/**
 * The in-memory discovery query. Filters the corpus by free-text `q` and top-level `category`, then
 * applies the adaptive facet filters and the `sort`. The seam for the real ranking service.
 */
export function getResults(params: ExploreParams): ExploreItem[] {
	const category = params.category;
	let items = allItems().filter((it) => inCategory(it, category) && matchesQuery(it, params.q));

	const skillFacet = params.filters.skill ?? params.filters.roles;
	if (skillFacet?.length) {
		items = items.filter((it) => it.skills.some((s) => skillFacet.includes(s.category)));
	}
	if (params.filters.verified?.includes("verified")) {
		items = items.filter((it) => it.owner.verified);
	}
	const catFacet = params.filters.cat;
	if (catFacet?.length) {
		items = items.filter((it) =>
			(it.type === "services" || it.type === "products") && catFacet.includes(it.category)
		);
	}
	const modelFacet = params.filters.model;
	if (modelFacet?.length) {
		// Delivery model is a `ServiceItem` field, not a category — "Session" and "Group Session" are
		// how a service is DELIVERED, so a Sessions chip is this facet rather than a top-level scope.
		//
		// Note the shape: unlike `cat`/`stage`, which drop everything outside the one entity they
		// describe, this leaves non-services untouched. Within `category=services` the two readings are
		// identical, so the difference only bites when a `model` value survives a category switch in the
		// URL — where dropping every project on a projects query would be an empty page the reader has
		// no way to explain. A facet that cannot apply should be inert, not destructive.
		items = items.filter((it) => it.type !== "services" || modelFacet.includes(it.serviceType));
	}
	const stageFacet = params.filters.stage;
	if (stageFacet?.length) {
		items = items.filter((it) =>
			it.type === "projects" &&
			stageFacet.some((s) => it.stage.toLowerCase().startsWith(s.replace("-", " ")))
		);
	}
	const priceMax = Number(params.filters.price?.[0]);
	if (Number.isFinite(priceMax)) {
		items = items.filter((it) => {
			const v = priceValue(it);
			return !Number.isFinite(v) || v <= priceMax;
		});
	}
	const ratingMin = Number(params.filters.rating?.[0]);
	if (Number.isFinite(ratingMin)) {
		items = items.filter((it) => topScore(it) >= ratingMin);
	}

	const sorted = [...items];
	switch (params.sort) {
		case "rating":
			sorted.sort((a, b) => topScore(b) - topScore(a));
			break;
		case "price_asc":
			sorted.sort((a, b) => priceValue(a) - priceValue(b));
			break;
		case "newest":
			sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			break;
		default:
			sorted.sort(compareRecommended);
	}
	return sorted;
}
// #endregion

// #region Grouping
/**
 * The merged section definitions, in the canonical Search-Results order:
 * Services → Products → Freelancers & Teams → Projects → People & Businesses → Articles.
 */
const RESULT_GROUPS: Array<Omit<ResultGroup, "items">> = [
	{ key: "services", title: "Services", primary: "services", variant: "rail" },
	{ key: "products", title: "Products", primary: "products", variant: "rail" },
	{ key: "talent", title: "Freelancers & Teams", primary: "freelancers", variant: "rail" },
	{ key: "projects", title: "Projects", primary: "projects", variant: "list" },
	{ key: "people", title: "People & Businesses", primary: "users", variant: "rail" },
	{ key: "articles", title: "Articles", primary: "articles", variant: "rail" },
];

/** The entity formats folded into each merged section key. */
const GROUP_MEMBERS: Record<string, ExploreEntity[]> = {
	services: ["services"],
	products: ["products"],
	talent: ["freelancers", "teams"],
	projects: ["projects"],
	people: ["users", "businesses"],
	articles: ["articles"],
};

/** Fold results into the merged Search-Results sections, preserving ranked order. Empty sections drop. */
export function groupResults(items: ExploreItem[]): ResultGroup[] {
	return RESULT_GROUPS
		.map((g) => ({
			...g,
			items: items.filter((it) => GROUP_MEMBERS[g.key].includes(it.type)),
		}))
		.filter((g) => g.items.length > 0);
}

/** Look up a single item by id — the standalone `/view/[id]` + detail-drawer source. */
export function findItem(id: string): ExploreItem | undefined {
	return allItems().find((it) => it.id === id);
}

/**
 * Expand a small result set into a larger deterministically-varied pool for the isolated unified feed,
 * so window-scrolled virtualization + infinite loading have real volume. Cycles base items with
 * suffixed ids (stable, no RNG). A no-op when the base already meets `target`.
 */
export function expandItems(items: ExploreItem[], target: number): ExploreItem[] {
	if (items.length === 0 || items.length >= target) return items;
	const out: ExploreItem[] = [];
	for (let i = 0; i < target; i++) {
		const base = items[i % items.length];
		out.push(i < items.length ? base : { ...base, id: `${base.id}-x${i}` });
	}
	return out;
}

/** Classify a freelancer's utilisation into a load band (drives the workload meter copy/severity). */
export function workloadBand(
	level: number,
): { id: "light" | "moderate" | "busy"; label: string } {
	if (level >= 85) return { id: "busy", label: "Busy" };
	if (level >= 50) return { id: "moderate", label: "Moderate" };
	return { id: "light", label: "Light" };
}
// #endregion

// #region Related
/** Curated "related" search terms per scope — the stub behind the results header's related row. */
const RELATED_BY_CATEGORY: Record<string, string[]> = {
	all: ["Brand refresh", "Realtime backend", "AI product design", "Pitch deck", "Webflow build"],
	freelancers: ["Product design", "Frontend", "3D & motion", "Brand systems", "Content"],
	teams: ["Brand studio", "Product team", "Content crew", "Full-stack studio"],
	businesses: ["Fintech", "Commerce", "Media", "SaaS"],
	services: ["Brand identity", "Landing page", "Design system", "Launch film", "MVP build"],
	projects: ["Wallet redesign", "Analytics platform", "Mobile app", "Design system"],
	products: ["UI kits", "Templates", "Presets", "Icons", "3D scenes"],
	articles: ["Hiring a team", "Escrow explained", "Getting started", "Paying by stage"],
	users: ["Creative direction", "Founders", "Advisors"],
};

/** Related search suggestions for the results header. Curated per scope, de-duped against the query. */
export function relatedSearches(params: ExploreParams, limit = 6): string[] {
	const base = RELATED_BY_CATEGORY[params.category] ?? RELATED_BY_CATEGORY.all;
	const q = params.q.trim().toLowerCase();
	return base.filter((t) => t.toLowerCase() !== q).slice(0, limit);
}
// #endregion
