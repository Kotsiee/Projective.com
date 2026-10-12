import { getExplore } from "./api.ts";
import { serializeExploreParams } from "./explore-state.ts";
import { BACKGROUND_HEADER } from "@web/utils/offline.ts";
import { logger } from "@web/utils/logger.ts";
import type { ExploreParams } from "../types/explore-types.ts";
import type {
	EmbeddingsStatus,
	EntityView,
	ExploreItem,
	HomeFeed,
	SearchPayload,
	SuggestQuery,
	Suggestions,
} from "../types/explore-types.ts";
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
	/**
	 * Run a discovery search (grouped sections, or one page of the isolated feed); `signal` cancels a
	 * superseded one.
	 */
	search(
		params: ExploreParams,
		page?: { offset?: number; limit?: number },
		signal?: AbortSignal,
	): Promise<ExploreResult<SearchPayload>> {
		const sp = new URLSearchParams(queryFromParams(params));
		if (page?.offset) sp.set("offset", String(page.offset));
		if (page?.limit) sp.set("limit", String(page.limit));
		const qs = sp.toString();
		return getExplore<SearchPayload>(`/api/explore/search${qs ? `?${qs}` : ""}`, { signal });
	},

	/** The curated related-search terms for the results header. */
	related(params: ExploreParams): Promise<ExploreResult<{ related: string[] }>> {
		const qs = queryFromParams(params);
		return getExplore<{ related: string[] }>(`/api/explore/related${qs ? `?${qs}` : ""}`);
	},

	/** Typeahead suggestions for a typed prefix in a scope; `signal` cancels a superseded keystroke. */
	suggest(query: SuggestQuery, signal?: AbortSignal): Promise<ExploreResult<Suggestions>> {
		const sp = new URLSearchParams({ q: query.q });
		if (query.scope !== "all") sp.set("scope", query.scope);
		return getExplore<Suggestions>(`/api/explore/suggest?${sp}`, { signal });
	},

	/** Look up a single item by id (detail drawer / deep-link prefetch). */
	item(id: string): Promise<ExploreResult<{ item: ExploreItem }>> {
		return getExplore<{ item: ExploreItem }>(`/api/explore/item?id=${encodeURIComponent(id)}`);
	},

	/**
	 * The composed Entity View projection for one listing — what `/view/[id]` SSRs, fetched on demand
	 * by the profile's service modal so its preview column renders the SAME projection through the
	 * same parts. 404 when the id resolves to nothing.
	 */
	view(id: string): Promise<ExploreResult<EntityView>> {
		return getExplore<EntityView>(`/api/explore/view?id=${encodeURIComponent(id)}`);
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

	/**
	 * Tell the server a SIGNED-IN reader opened an item in place (the results drawer) — the client half
	 * of "Because you viewed"; a page they navigate to records itself server-side. A background beacon:
	 * never awaited, never a sign-in redirect, and a failure is logged rather than shown.
	 */
	recordView(id: string): void {
		const url = "/api/explore/views";
		const body = JSON.stringify({ id });
		if (navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
		fetch(url, {
			method: "POST",
			body,
			keepalive: true,
			headers: { "content-type": "application/json", [BACKGROUND_HEADER]: "1" },
		}).catch((error: unknown) =>
			logger.warn("A discovery view could not be recorded", {
				id,
				reason: error instanceof Error ? error.message : String(error),
			})
		);
	},

	/**
	 * DEVELOPMENT ONLY — the embeddings switch as the server resolves it for this browser, with what
	 * decided it (Decision #179): the Dev Context Switcher's status line. The route answers 404 in a
	 * production build.
	 */
	ranking(): Promise<ExploreResult<EmbeddingsStatus>> {
		return getExplore<EmbeddingsStatus>("/api/explore/ranking");
	},
};

export type { HomeFeed, SearchPayload };
