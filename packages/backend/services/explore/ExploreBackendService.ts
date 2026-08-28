import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isExploreBackendLive } from "../../core/supabase.ts";
import {
	allItems,
	expandItems,
	findItem as lookupItem,
	getResults,
	groupResults,
	homeFeed,
	relatedSearches,
} from "./query.ts";
import { buildViewPage } from "./view-fixtures.ts";
import type {
	EntityView,
	ExploreItem,
	ExploreParams,
	HomeFeed,
	SearchPayload,
} from "@projective/types/explore";

/**
 * ExploreBackendService — the FAT server-side discovery service.
 *
 * It owns the discovery query: filtering, ranking, merged-section grouping, item lookup, and paged
 * feed expansion. Thin routes under `apps/web/routes/api/explore/*` do only HTTP parsing + Zod
 * validation, then delegate here and map the returned {@link ServiceResult} to a `Response`; the
 * `/explore` route calls these directly for SSR first paint. Islands never reach this — they `fetch`
 * the routes via the thin `ExploreService`.
 *
 * **Stub mode (default).** With `EXPLORE_BACKEND_LIVE` off (see {@link isExploreBackendLive}) the
 * service answers from the in-memory {@link homeFeed}/{@link getResults} fixtures — the running app is
 * unchanged. The live path (Supabase discovery tables + search embeddings) slots in behind the same
 * gate when it lands, a fill-in rather than a re-architecture.
 */

// #region Constants
/** The stub "endless" pool size the isolated unified feed pages through. */
const FEED_POOL = 144;
/** Default page size when a caller omits `limit`. */
const FEED_PAGE = 18;
// #endregion

/** Compute a search page from the fixtures (the stub read path; also the live fallback for now). */
function buildSearch(params: ExploreParams, offset: number, limit: number): SearchPayload {
	const results = getResults(params);
	const isolated = params.category !== "all";
	const related = relatedSearches(params);

	if (!isolated) {
		return {
			count: results.length,
			isolated: false,
			items: [],
			poolTotal: 0,
			groups: groupResults(results),
			related,
			hasMore: false,
		};
	}

	const pool = expandItems(results, FEED_POOL);
	const page = pool.slice(offset, offset + limit);
	return {
		count: results.length,
		isolated: true,
		items: page,
		poolTotal: pool.length,
		groups: [],
		related,
		hasMore: offset + limit < pool.length,
	};
}

export class ExploreBackendService {
	/**
	 * Run a discovery search. Returns the grouped merged sections (cross-category) or a single page of
	 * the isolated-category feed, plus the real count and related terms.
	 */
	static search(
		input: { params: ExploreParams; offset?: number; limit?: number },
	): ServiceResult<SearchPayload> {
		const offset = Math.max(0, input.offset ?? 0);
		const limit = Math.min(FEED_POOL, Math.max(1, input.limit ?? FEED_PAGE));
		if (!isExploreBackendLive()) {
			return ok(buildSearch(input.params, offset, limit));
		}
		// LIVE: query the discovery tables + search embeddings (not yet implemented) — fall back to the
		// fixture-backed query so behaviour is preserved until that path lands.
		return ok(buildSearch(input.params, offset, limit));
	}

	/** The composed Home discovery feed (sections + reserved promos) for State A first paint. */
	static home(): ServiceResult<HomeFeed> {
		return ok(homeFeed());
	}

	/** Look up a single item by id — backs the detail drawer + SEO/title resolution. */
	static item(id: string): ServiceResult<{ item: ExploreItem }> {
		const item = lookupItem(id);
		if (!item) return fail(404, { message: `No item found for id "${id}".` });
		return ok({ item });
	}

	/**
	 * Resolve a BATCH of ids in one pass — the "Continue where you left off" rail hands over the dozen
	 * or so references it has stored, rather than issuing a dozen `item()` round trips.
	 *
	 * Two deliberate properties. Results come back **in the order the ids were given**: that order is
	 * the reader's own recency, it is the only thing the stored list actually knows, and re-ranking it
	 * here would silently rewrite their history into ours. And an id that resolves to nothing is simply
	 * **omitted** rather than failing the batch: a stored reference goes stale the moment its listing
	 * is unpublished, and one dead entry must not cost the reader the other eleven.
	 */
	static items(ids: string[]): ServiceResult<ExploreItem[]> {
		const byId = new Map(allItems().map((it) => [it.id, it]));
		const found: ExploreItem[] = [];
		for (const id of ids) {
			const item = byId.get(id);
			if (item) found.push(item);
		}
		return ok(found);
	}

	/**
	 * The composed Entity View page (`/view/[id]`): the item plus its derived media gallery, resolved
	 * pricing/trust facts, deliverable specs, cross-sell rails, and aggregated reviews. Built
	 * deterministically from the fixtures today; the discovery + reviews tables slot in behind the same
	 * gate later. Backs the standalone item page + its sidebar action lane.
	 */
	static viewPage(id: string): ServiceResult<EntityView> {
		const item = lookupItem(id);
		if (!item) return fail(404, { message: `No item found for id "${id}".` });
		return ok(buildViewPage(item));
	}

	/** Related search terms for a query/scope — the results-header "Related" row. */
	static related(params: ExploreParams): ServiceResult<{ related: string[] }> {
		return ok({ related: relatedSearches(params) });
	}
}
