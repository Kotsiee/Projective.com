import { parsePriceMajor, PIPELINE_LOW } from "./pricing.ts";
import { peekCatalog } from "./live-catalog.ts";
import type {
	ExploreEntity,
	ExploreItem,
	ExploreParams,
	ResultGroup,
} from "@projective/types/explore";

/**
 * Explore — pure discovery selectors (server side).
 *
 * The query behind {@link ExploreBackendService}: filter + sort a corpus, fold it into the merged
 * Search-Results sections, and derive the related-terms row. PURE over the list it is handed — the
 * list itself is the live catalogue (`./live-catalog.ts`), loaded once per TTL and shared by every
 * discovery surface. Deterministic (no RNG, SSR/resume-safe).
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

// #region Ranking
/** The best rating track available on an item (helper preferred) — used by the "Top rated" sort. */
function topScore(item: ExploreItem): number {
	return Math.max(item.rating?.asHelper?.value ?? 0, item.rating?.asClient?.value ?? 0);
}

/**
 * The `recommended` ordering: verified owners first, then by best rating track.
 *
 * A marketplace-wide quality heuristic, not a personalisation — nothing here reads a viewer. Exported
 * so the Home feed's Recommended lists and a `?sort=recommended` search rank through one comparator:
 * two copies of "what we put forward" would eventually disagree, and the disagreement would show up
 * as the same corpus ordered two ways on two surfaces a reader moves between in one click.
 */
export function compareRecommended(a: ExploreItem, b: ExploreItem): number {
	return (Number(b.owner.verified ?? false) - Number(a.owner.verified ?? false)) ||
		(topScore(b) - topScore(a));
}

/**
 * Rank a list by {@link compareRecommended}, returning a copy. Generic over the element type so a
 * caller holding a narrowed list (`ServiceItem[]`, `ProfileItem[]`) gets that type back.
 */
export function rankRecommended<T extends ExploreItem>(items: readonly T[]): T[] {
	return [...items].sort(compareRecommended);
}
// #endregion

// #region Query
/** Parse a leading price out of a formatted string / derived floor for the "price" sort. */
function priceValue(item: ExploreItem): number {
	if (item.type === "services") {
		// Sort a pipeline by its low-intensity ticket floor (0.5×) and a session by its per-session
		// price, so the range/unit pricing shown on the card orders consistently.
		if (item.serviceType === "Pipeline" && item.ticketPrice) return item.ticketPrice * PIPELINE_LOW;
		if (
			(item.serviceType === "Session" || item.serviceType === "Group Session") && item.sessionPrice
		) return item.sessionPrice;
		return item.priceMinor !== undefined ? item.priceMinor / 100 : parsePriceMajor(item.price);
	}
	if (item.type === "products") {
		return item.priceMinor !== undefined ? item.priceMinor / 100 : parsePriceMajor(item.price);
	}
	if (item.type === "freelancers" && item.servicePrices?.length) {
		return lowestActivePrice(item.servicePrices) ?? 0;
	}
	return Number.POSITIVE_INFINITY;
}

/**
 * A service's promised delivery window in DAYS, read off its display string (`"10-day delivery"`,
 * `"2-week delivery"`) — the same string the card prints, so the facet and the card cannot disagree.
 * `null` for anything that is not a service or does not name a window, and such an item is never
 * excluded by the delivery facet: a filter that cannot apply must be inert, not destructive.
 */
export function deliveryDays(item: ExploreItem): number | null {
	if (item.type !== "services") return null;
	const m = /(\d+)\s*-?\s*(day|week|month)/i.exec(item.delivery);
	if (!m) return null;
	const n = Number(m[1]);
	const unit = m[2].toLowerCase();
	return unit === "week" ? n * 7 : unit === "month" ? n * 30 : n;
}

/**
 * The `[lo, hi]` a range facet's URL values stand for. Two values are the pair; ONE value is the
 * legacy "up to" form the old single-thumb slider wrote, and still resolves (a bookmarked
 * `?price=500` keeps meaning "up to $500"). Anything unparseable is unbounded on that side.
 */
function rangeBounds(values: string[] | undefined): [number, number] | null {
	if (!values?.length) return null;
	const a = Number(values[0]);
	const b = Number(values[1]);
	if (values.length === 1) {
		return Number.isFinite(a) ? [Number.NEGATIVE_INFINITY, a] : null;
	}
	const lo = Number.isFinite(a) ? a : Number.NEGATIVE_INFINITY;
	const hi = Number.isFinite(b) ? b : Number.POSITIVE_INFINITY;
	return lo <= hi ? [lo, hi] : [hi, lo];
}

/**
 * Sibling entity types folded into a merged scope. "Freelancers & Teams" and "People & Businesses"
 * are single split-talent scopes, so those tokens match both members.
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
		"category" in item ? String(item.category) : "",
	].join(" ").toLowerCase();
	return q.toLowerCase().split(/\s+/).every((term) => hay.includes(term));
}

/**
 * The discovery query. Filters the corpus by free-text `q` and top-level `category`, then applies the
 * adaptive facet filters and the `sort`.
 */
export function getResults(corpus: readonly ExploreItem[], params: ExploreParams): ExploreItem[] {
	const category = params.category;
	let items = corpus.filter((it) => inCategory(it, category) && matchesQuery(it, params.q));

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
		// Delivery model is a `ServiceItem` field, not a category. Non-services are left untouched: a
		// `model` value surviving a category switch in the URL must not empty a projects page.
		items = items.filter((it) => it.type !== "services" || modelFacet.includes(it.serviceType));
	}
	const stageFacet = params.filters.stage;
	if (stageFacet?.length) {
		items = items.filter((it) =>
			it.type === "projects" &&
			stageFacet.some((s) => it.stage.toLowerCase().startsWith(s.replace("-", " ")))
		);
	}
	const price = rangeBounds(params.filters.price);
	if (price) {
		items = items.filter((it) => {
			const v = priceValue(it);
			return !Number.isFinite(v) || (v >= price[0] && v <= price[1]);
		});
	}
	const deliveryMax = Number(params.filters.delivery?.[0]);
	if (Number.isFinite(deliveryMax)) {
		items = items.filter((it) => {
			const d = deliveryDays(it);
			return d === null || d <= deliveryMax;
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
/**
 * The results header's "Related" row — the categories and skills most common among what is actually
 * listed in this scope, most frequent first, with the current query removed.
 *
 * Derived from the corpus rather than curated, so a related term always leads somewhere: a curated
 * list suggests searches the marketplace may have nothing for, and a suggestion that returns zero
 * results teaches a reader to stop trusting the row.
 */
export function relatedSearches(
	corpus: readonly ExploreItem[],
	params: ExploreParams,
	limit = 6,
): string[] {
	const q = params.q.trim().toLowerCase();
	const counts = new Map<string, { label: string; n: number }>();
	const bump = (raw: string) => {
		const label = raw.trim();
		const key = label.toLowerCase();
		if (!label || key === q) return;
		const entry = counts.get(key);
		if (entry) entry.n++;
		else counts.set(key, { label: label[0].toUpperCase() + label.slice(1), n: 1 });
	};
	for (const it of corpus) {
		if (!inCategory(it, params.category)) continue;
		if ("category" in it && typeof it.category === "string") bump(it.category);
		for (const s of it.skills) bump(s.label);
	}
	return [...counts.values()]
		.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
		.slice(0, limit)
		.map((e) => e.label);
}
// #endregion

// #region Synchronous bridge (transitional)
/**
 * Resolve an item id against the most recently LOADED catalogue, synchronously.
 *
 * TRANSITIONAL. It exists for the booking and pipeline-instantiation resolvers, which still resolve a
 * listing id synchronously against the snapshot; this function goes when they read the catalogue the
 * way every other async caller does — `await loadCatalog()` and `catalog.byId`. Returns `undefined`
 * when no catalogue has been loaded in this process yet, which is why the routes that reach it warm
 * the catalogue first.
 */
export function findItem(id: string): ExploreItem | undefined {
	return peekCatalog()?.byId.get(id);
}
// #endregion
