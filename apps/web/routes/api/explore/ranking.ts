import { define } from "@web/utils/state.ts";
import { IS_DEV } from "@web/utils/dev.ts";
import { embeddingsStatusFor } from "@features/explore/core/discovery-ranking.ts";
import type { EmbeddingsStatus } from "@projective/types/explore";
import type { ExploreResult } from "@features/explore/types/results.ts";

/**
 * `GET /api/explore/ranking` — DEVELOPMENT ONLY: the embeddings switch as it resolves for this request,
 * with every input that decided it (Decision #179) — the Dev Context Switcher's status line. A
 * production build answers 404 and the branch below is dead code there.
 */
export const handler = define.handlers({
	GET(ctx) {
		if (!IS_DEV) return new Response(null, { status: 404 });
		const status = embeddingsStatusFor(ctx.req);
		ctx.state.discoveryRanking = status.ranking;
		const body: ExploreResult<EmbeddingsStatus> = { ok: true, data: status };
		return Response.json(body, { headers: { "cache-control": "no-store" } });
	},
});
