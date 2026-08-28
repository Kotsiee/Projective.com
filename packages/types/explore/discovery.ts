import { z } from "zod";
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
