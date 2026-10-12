import { define } from "@web/utils/state.ts";
import { rankingHeaders } from "@features/explore/core/discovery-ranking.ts";

/**
 * `/api/explore/*` — in development, every response says how its discovery content was ordered
 * (`x-discovery-ranking: semantic | heuristic`, Decision #179). A handler that ranks records what
 * actually ran on `ctx.state.discoveryRanking`; everything else, and every fallback, is heuristic.
 * Production sends no header.
 */
export default define.middleware(async (ctx) => {
	const res = await ctx.next();
	for (const [name, value] of rankingHeaders(ctx.state.discoveryRanking ?? "heuristic")) {
		res.headers.set(name, value);
	}
	return res;
});
