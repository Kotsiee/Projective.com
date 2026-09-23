import { z } from "zod";
import type { Facet } from "./facets.ts";
import { ExploreCategory, ExploreEntity, ExploreItemSchema } from "./items.ts";
import type {
	ArticleItem,
	CtaBanner,
	ExploreItem,
	HelpArticle,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
	SponsoredSlot,
} from "./items.ts";

/**
 * explore.discovery — the Zod SSOT for discovery QUERY state and the shape of a grouped result set.
 *
 * `ExploreParams` is the normalised `/explore?…` query the route parser produces and the fat
 * {@link ExploreBackendService} consumes; `ResultGroup` is one merged Search-Results section. Kept
 * here (not in the app feature) so both the app and the backend package share one definition.
 */

// #region Query state
/** The parsed, normalised query state behind `/explore`. */
export const ExploreParamsSchema = z.object({
	/** Free-text query (`?q=`). */
	q: z.string(),
	/** Selected top-level category (`?category=` / legacy `?type=`); `all` when none. */
	category: ExploreCategory,
	/** Sort key; defaults to `recommended`. */
	sort: z.string(),
	/** Adaptive filter selections — one entry per active facet, each a list of values. */
	filters: z.record(z.string(), z.array(z.string())),
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

/**
 * Everything the public landing page renders, resolved in one server call. The home feed is the
 * payload's spine — without it there is nothing to show — while the quotes and the running totals are
 * garnish: when either read fails the page still renders, with that part simply absent.
 */
export interface LandingPayload {
	home: HomeFeed;
	/** Real reviews worth quoting; empty when there are none or the read failed. */
	testimonials: Testimonial[];
	/** The running totals, or `null` when they could not be read. */
	stats: PlatformStats | null;
	/** The hero's backdrop — the platform's own public asset, or `null` when it is not uploaded. */
	heroImage: string | null;
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
	sponsored: SponsoredSlot[];
	helpArticles: HelpArticle[];
	ctas: { freelancer: CtaBanner; team: CtaBanner };
	/**
	 * The Recommended panel's four ranked lists. Ranked by the SAME global quality heuristic the
	 * search path's default sort uses — verified first, then rating/score — NOT by anything
	 * per-viewer: `homeFeed()` takes no viewer argument and there is no view history on the server.
	 * It is "recommended" in the sense of "what this marketplace would put forward", and the surface
	 * must not imply otherwise.
	 */
	recommended: {
		services: ServiceItem[];
		products: ProductItem[];
		projects: ProjectItem[];
		people: ProfileItem[];
	};
}
// #endregion
