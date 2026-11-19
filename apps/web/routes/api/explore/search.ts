import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { inspectExploreQuery } from "@features/explore/core/explore-state.ts";
import { invalidQuery, toExploreResponse } from "@features/explore/core/respond.ts";
import {
	discoveryClientFor,
	semanticRankingFor,
} from "@features/explore/core/discovery-ranking.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";

/**
 * `GET /api/explore/search` — thin route: parse the discovery query and its `offset`/`limit` at the
 * API door (`inspectExploreQuery`), then delegate to the fat {@link ExploreBackendService}, which
 * returns the grouped merged sections (cross-category) or a single page of the isolated-category
 * feed. Islands call this via `ExploreService` for client-side refinement; the `/explore` route
 * handler calls the service directly for SSR first paint.
 *
 * A query the door had to correct — `q` over 512 characters, an unknown order, category or key, an
 * over-long facet value, an out-of-bounds page — is a 422 naming each key (CAS S37). Whether voyage-4
 * similarity re-ranks it is this request's embeddings switch, within the caller's query-embedding
 * budget (CAS S30); past it the search ranks heuristically, never a 429. A 13–17 viewer gets no
 * promoted slot (Decision #454).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const query = inspectExploreQuery(ctx.url.searchParams, "api");
		const problems = Object.entries(query.problems);
		if (problems.length > 0) {
			return invalidQuery({ issues: problems.map(([key, message]) => ({ path: [key], message })) });
		}
		const actor = readActor(ctx);
		const result = await ExploreBackendService.search({
			params: query.params,
			offset: query.offset,
			limit: query.limit,
			actor,
			client: discoveryClientFor(ctx.info.remoteAddr, ctx.req, actor.userId),
			semantic: semanticRankingFor(ctx.req),
			showPromoted: !isRestrictedRequest(ctx.req, ctx.state.userContext),
		});
		ctx.state.discoveryRanking = result.ranking;
		ctx.state.discoveryRankingReason = result.reason;
		return toExploreResponse(result);
	},
});
