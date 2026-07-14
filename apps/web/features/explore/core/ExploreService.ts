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
};

export type { HomeFeed, SearchPayload };
