import { getExplore } from "./api.ts";
import { serializeExploreParams } from "./explore-state.ts";
import type { ExploreParams } from "../types/explore-types.ts";
import type { ExploreItem, HomeFeed, SearchPayload } from "../types/explore-types.ts";
import type { ExploreResult } from "../types/results.ts";

/**
 * ExploreService — the THIN client discovery service.
 *
 * A dumb object of named methods; each just builds a query string and forwards to a `/api/explore/*`
 * route, returning a soft {@link ExploreResult}. No fixtures, no query logic, no scattered `fetch` —
 * islands call these for client-side refinement (filter/sort changes, infinite-scroll pages, drawer
 * refresh) while the fat {@link ExploreBackendService} owns all ranking/grouping (mirrors AuthService).
 */

/** Extract the `?…` query fragment from a serialized `/explore?…` path (`""` when none). */
function queryFromParams(params: ExploreParams): string {
	const path = serializeExploreParams(params);
	const q = path.indexOf("?");
	return q === -1 ? "" : path.slice(q + 1);
}

export const ExploreService = {
	/** Run a discovery search (grouped sections, or one page of the isolated feed). */
	search(
		params: ExploreParams,
		page?: { offset?: number; limit?: number },
	): Promise<ExploreResult<SearchPayload>> {
		const sp = new URLSearchParams(queryFromParams(params));
		if (page?.offset) sp.set("offset", String(page.offset));
		if (page?.limit) sp.set("limit", String(page.limit));
		const qs = sp.toString();
		return getExplore<SearchPayload>(`/api/explore/search${qs ? `?${qs}` : ""}`);
	},

	/** The curated related-search terms for the results header. */
	related(params: ExploreParams): Promise<ExploreResult<{ related: string[] }>> {
		const qs = queryFromParams(params);
		return getExplore<{ related: string[] }>(`/api/explore/related${qs ? `?${qs}` : ""}`);
	},

	/** Look up a single item by id (detail drawer / deep-link prefetch). */
	item(id: string): Promise<ExploreResult<{ item: ExploreItem }>> {
		return getExplore<{ item: ExploreItem }>(`/api/explore/item?id=${encodeURIComponent(id)}`);
	},

	/**
	 * Resolve a batch of ids in one request — the "Continue where you left off" rail's stored
	 * references. Returns the items that still exist, in the order the ids were given (the reader's
	 * recency); ids that resolve to nothing are omitted rather than failing the batch.
	 *
	 * An empty list answers locally instead of asking the route to reject it: "the reader has viewed
	 * nothing yet" is a normal first-visit state, not a bad request, and it deserves neither a round
	 * trip nor an error message the caller then has to special-case back into an empty rail.
	 */
	items(ids: string[]): Promise<ExploreResult<ExploreItem[]>> {
		if (ids.length === 0) return Promise.resolve({ ok: true, data: [] });
		const qs = encodeURIComponent(ids.join(","));
		return getExplore<ExploreItem[]>(`/api/explore/items?ids=${qs}`);
	},
};

export type { HomeFeed, SearchPayload };
