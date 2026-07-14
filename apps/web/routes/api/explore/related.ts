import { define } from "@web/utils/state.ts";
import { parseExploreParams } from "@features/explore/core/explore-state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/explore/related` — thin route: parse the query/scope and delegate to the fat service for
 * the curated "Related" search terms shown beneath the results header.
 */
export const handler = define.handlers({
	GET(ctx) {
		const params = parseExploreParams(ctx.url.searchParams);
		return toExploreResponse(ExploreBackendService.related(params));
	},
});
