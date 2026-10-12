import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { parseExploreParams } from "@features/explore/core/explore-state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { semanticRankingFor } from "@features/explore/core/discovery-ranking.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/explore/search` — thin route: parse the discovery query (+ optional `offset`/`limit`),
 * then delegate to the fat {@link ExploreBackendService}, which returns the grouped merged sections
 * (cross-category) or a single page of the isolated-category feed. Islands call this via
 * `ExploreService` for client-side refinement; the `/explore` route handler calls the service directly
 * for SSR first paint. Whether voyage-4 similarity re-ranks it is this request's embeddings switch.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const params = parseExploreParams(ctx.url.searchParams);
		const offsetRaw = Number(ctx.url.searchParams.get("offset"));
		const limitRaw = Number(ctx.url.searchParams.get("limit"));
		const result = await ExploreBackendService.search({
			params,
			offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
			limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
			actor: readActor(ctx),
			semantic: semanticRankingFor(ctx.req),
		});
		ctx.state.discoveryRanking = result.ranking;
		return toExploreResponse(result);
	},
});
