import { z } from "zod";
import type { Facet } from "./facets.ts";
import { ExploreCategory, ExploreEntity, ExploreItemSchema } from "./items.ts";
import type {
	ArticleItem,
	ExploreItem,
	ProductItem,
	ProfileItem,
	ProjectItem,
	PromoSlot,
	ServiceItem,
	SponsoredPromo,
} from "./items.ts";

/**
 * explore.discovery — the Zod SSOT for discovery QUERY state and the shape of a grouped result set.
 *
 * `ExploreParams` is the normalised `/explore?…` query the route parser produces and the fat
 * {@link ExploreBackendService} consumes; `ResultGroup` is one merged Search-Results section. Kept
 * here (not in the app feature) so both the app and the backend package share one definition.
 */

// #region Query state
/**
 * The `/explore` orders (`?sort=`). `best_match` ranks a typed search by how well each item matches
 * the words AND its quality score; `recommended` by the quality score alone; the other three are the
 * field orders a reader picks.
 */
export const ExploreSort = z.enum(["best_match", "recommended", "rating", "price_asc", "newest"]);
export type ExploreSort = z.infer<typeof ExploreSort>;

/**
 * The order a search takes when the reader has not picked one: Best match with a query, Recommended
 * without one (Best match has no words to read there).
 */
export function defaultExploreSort(q: string): ExploreSort {
	return q.trim() ? "best_match" : "recommended";
}

/** Whether `value` names one of the {@link ExploreSort} orders. */
export function isExploreSort(value: string | null | undefined): value is ExploreSort {
	return ExploreSort.safeParse(value).success;
}

/**
 * The order a requested `sort` resolves to for `q`: absent or unknown → {@link defaultExploreSort},
 * and `best_match` without a query → `recommended`. Any other order passes through.
 */
export function resolveExploreSort(sort: string | null | undefined, q: string): ExploreSort {
	if (!isExploreSort(sort)) return defaultExploreSort(q);
	return sort === "best_match" && !q.trim() ? "recommended" : sort;
}

// #region Query bounds (COMMS SR2, CAS S37)
/** The longest free-text query a door accepts. A longer one is corrected to its first 512 characters. */
export const EXPLORE_QUERY_MAX = 512;
/** The most values one facet carries. */
export const EXPLORE_FACET_VALUES_MAX = 20;
/** The longest single facet value. */
export const EXPLORE_FACET_VALUE_MAX = 64;
/** The deepest offset a feed page of `GET /api/explore/search` may start at. */
export const EXPLORE_OFFSET_MAX = 10_000;
/** The largest page `GET /api/explore/search` serves (the service's own feed ceiling). */
export const EXPLORE_LIMIT_MAX = 60;

/**
 * Every adaptive facet a discovery query may carry: the ids the sidebar's facet lists declare
 * (`apps/web/features/explore/core/filter-config.ts`, held equal by `explore-state.test.ts`), which
 * are also the keys the service filters on. Any other key is not a facet, so it never reaches the
 * search or `search.query_logs.filters_applied`.
 */
export const EXPLORE_FACET_KEYS = [
	"budget",
	"cat",
	"delivery",
	"industry",
	"members",
	"model",
	"price",
	"rating",
	"readMinutes",
	"roles",
	"skill",
	"stage",
	"topic",
	"verified",
] as const;
export const ExploreFacetKey = z.enum(EXPLORE_FACET_KEYS);
export type ExploreFacetKey = z.infer<typeof ExploreFacetKey>;

/** Whether `key` is one of the {@link EXPLORE_FACET_KEYS}. */
export function isExploreFacetKey(key: string): key is ExploreFacetKey {
	return (EXPLORE_FACET_KEYS as readonly string[]).includes(key);
}
// #endregion

/** One facet's selected values: 1–20 of them, each 1–64 characters. */
const FacetValuesSchema = z
	.array(z.string().min(1).max(EXPLORE_FACET_VALUE_MAX))
	.min(1)
	.max(EXPLORE_FACET_VALUES_MAX);

/**
 * The parsed, normalised query state behind `/explore`, bounded (CAS S37): both doors — the page and
 * `GET /api/explore/search` — produce only values this accepts (`explore-state.ts`).
 */
export const ExploreParamsSchema = z.object({
	/** Free-text query (`?q=`), at most {@link EXPLORE_QUERY_MAX} characters. */
	q: z.string().max(EXPLORE_QUERY_MAX),
	/** Selected top-level category (`?category=` / legacy `?type=`); `all` when none. */
	category: ExploreCategory,
	/** The order ({@link ExploreSort}); {@link defaultExploreSort} when the URL names none. */
	sort: ExploreSort,
	/** Adaptive filter selections, keyed by {@link EXPLORE_FACET_KEYS} only. */
	filters: z.record(z.string(), FacetValuesSchema).refine(
		(filters) => Object.keys(filters).every(isExploreFacetKey),
		{ message: "Not a facet of this search." },
	),
});
export type ExploreParams = z.infer<typeof ExploreParamsSchema>;
// #endregion

// #region Result grouping
/**
 * One merged results section. `primary` is the category its "Show all" link targets; `variant` picks
 * the presentation (a horizontal card rail vs. the text-forward projects list).
 */
export const ResultGroupSchema = z.object({
	key: z.string(),
	title: z.string(),
	primary: ExploreEntity,
	variant: z.enum(["rail", "list"]),
	items: z.array(ExploreItemSchema),
});
export type ResultGroup = z.infer<typeof ResultGroupSchema>;
// #endregion

// #region Transport payloads (cross-boundary DTOs)
/** One page of a discovery search — the payload the `/api/explore/search` route returns. */
export interface SearchPayload {
	/** The real result count (drives the "N results" line) — independent of the paged pool size. */
	count: number;
	/** Whether an isolated single category is active (paginated feed) vs. the grouped cross-cat feed. */
	isolated: boolean;
	/** Isolated feed: the requested page of items. Grouped feed: empty (items live under `groups`). */
	items: ExploreItem[];
	/** Isolated feed: total size of the pageable pool (drives `hasMore`). */
	poolTotal: number;
	/** Grouped feed: the merged Search-Results sections. Isolated feed: empty. */
	groups: ResultGroup[];
	/** Curated related search terms for the results header. */
	related: string[];
	/** Whether more pages remain in an isolated feed. */
	hasMore: boolean;
	/**
	 * The labelled "Promoted" slots for this search (Decision #454), each a listing that already
	 * matches it: at most one per services / products rail, on the first page only, and none for a
	 * 13–17 viewer. Kept apart from `items` and `groups`, which are the organic order untouched.
	 */
	promoted: SponsoredPromo[];
	/**
	 * Scope-specific facets the discovery service attaches for THIS query — a voice actor's accent, a
	 * translator's rate per word — merged over the app's static per-category list by `mergeFacets`
	 * (a same-`id` facet here replaces the static one). Optional and empty today: the fixture corpus
	 * carries no dynamic facets, so the seam exists without the service yet using it.
	 */
	facets?: Facet[];
}

/**
 * A REAL review, quoted on the landing page. Every field is read from the review and its author's
 * public profile — nothing is paraphrased, and a quote is never attributed to anyone but the person
 * who wrote it.
 */
export interface Testimonial {
	id: string;
	/** The review's own words. */
	quote: string;
	/** The review's own title. */
	title: string;
	rating: number;
	/** `client`: a buyer on the work they received. `freelancer`: a seller on a client they served. */
	voice: "client" | "freelancer";
	author: import("./items.ts").ExploreOwner;
	/** The author's headline, as their profile states it. */
	role: string;
}

/**
 * The platform's running totals — the landing hero's proof points, as AGGREGATES only. Read from a
 * definer view that projects counts and a sum and nothing a visitor could use to identify a row.
 */
export interface PlatformStats {
	/** Listed freelancers and teams — people a visitor could hire today. */
	helpers: number;
	/** Stages delivered and signed off. */
	stagesDelivered: number;
	/** Projects running or completed. */
	projectsLive: number;
	/** Money released to sellers, in minor units of {@link PlatformStats.paidOutCurrency}. */
	paidOutMinor: number;
	paidOutCurrency: string;
}

/** The composed Home discovery feed (State A first paint): sections keyed by format + reserved promos. */
export interface HomeFeed {
	users: ProfileItem[];
	freelancers: ProfileItem[];
	teams: ProfileItem[];
	businesses: ProfileItem[];
	services: ServiceItem[];
	projects: ProjectItem[];
	products: ProductItem[];
	articles: ArticleItem[];
	/**
	 * The reserved promo slots, in feed order: paid placements featured inside their rail, and the
	 * conversion and editorial breaks placed after the section each names.
	 */
	promos: PromoSlot[];
	/**
	 * The Recommended panel's four ranked lists. Ranked by the SAME discovery quality score the
	 * search path's default sort uses (cold-start prior, workload, Discovery Boost, Standing, trust
	 * penalty — `services/explore/ranking.ts`) — NOT by anything per-viewer. It is "recommended" in
	 * the sense of "what this marketplace would put forward", and the surface must not imply
	 * otherwise; the viewer's own rails are {@link HomeFeed.personal}.
	 */
	recommended: {
		services: ServiceItem[];
		products: ProductItem[];
		projects: ProjectItem[];
		people: ProfileItem[];
	};
	/** The signed-in viewer's own rails, read under their JWT; both `null` for a guest. */
	personal: PersonalRails;
	/**
	 * What the marketplace is opening this week (`trending`: three or more people per item), or —
	 * below that floor — what is new (`new`); `null` when neither has enough to fill a rail. The same
	 * for every viewer.
	 */
	trending: DiscoveryRail | null;
}

/**
 * What filled a discovery rail. The app words the heading from it, so a heading only ever claims
 * what the data supports: "Trending" only past the activity floor, "New on Projective" below it.
 */
export type DiscoveryRailKind = "because_viewed" | "for_you" | "saved" | "trending" | "new";

/** A rail the discovery service composed — the Home feed's personal and trending rails. */
export interface DiscoveryRail {
	kind: DiscoveryRailKind;
	/** `because_viewed`: the item the picks resemble; the heading names it. */
	anchor?: { id: string; title: string };
	/** `for_you`: what the picks matched — the viewer's recent activity, or their stated interests and skills. */
	basis?: "activity" | "interests";
	items: ExploreItem[];
}

/** The viewer's own rails (PRODUCT_SPEC §Reputation & Discovery 2, Recommender Logic). */
export interface PersonalRails {
	/** "Because you viewed …" — or "Picked for you" when there is no usable history. */
	viewed: DiscoveryRail | null;
	/** What the viewer saved, newest first. */
	saved: DiscoveryRail | null;
}
// #endregion
