import { define } from "@web/utils/state.ts";
import { parseExploreParams } from "@features/explore/core/explore-state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/explore/search` — thin route: parse the discovery query (+ optional `offset`/`limit`),
 * then delegate to the fat {@link ExploreBackendService}, which returns the grouped merged sections
 * (cross-category) or a single page of the isolated-category feed. Islands call this via
 * `ExploreService` for client-side refinement; the `/explore` route handler calls the service directly
 * for SSR first paint.
 */
export const handler = define.handlers({
	GET(ctx) {
		const params = parseExploreParams(ctx.url.searchParams);
		const offsetRaw = Number(ctx.url.searchParams.get("offset"));
		const limitRaw = Number(ctx.url.searchParams.get("limit"));
		return toExploreResponse(ExploreBackendService.search({
			params,
			offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
			limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
		}));
	},
});
