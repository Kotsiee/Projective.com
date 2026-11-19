import { define } from "@web/utils/state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import {
	BACKFILL_RUN_DEFAULT,
	isSearchCronAuthorised,
	runScheduledBackfill,
} from "@server/services/search/embedding-sync.ts";

/**
 * `POST /api/search/cron/embeddings` — the scheduler's entry point for the embedding backfill, the
 * `search-embeddings-backfill` job (COMMS SR2, CAS S14). Embeds at most `?limit=` (default 50, at
 * most 200) public discovery items whose stored vector is missing or stale, through
 * `runScheduledBackfill`; a no-op while embeddings are off.
 *
 * Authenticated by a bearer token (`SEARCH_CRON_SECRET`, at least 32 characters), compared in
 * constant time. Anything else — a missing or wrong token, or no secret configured — is a 404, like
 * the other cron routes. The body is ignored. Safe to call as often as the scheduler likes: a stored
 * vector is skipped by its text hash and model.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!isSearchCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Number(ctx.url.searchParams.get("limit") ?? BACKFILL_RUN_DEFAULT);
		return toExploreResponse(await runScheduledBackfill(limit));
	},
});
