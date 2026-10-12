import { define } from "@web/utils/state.ts";
import { SuggestQuerySchema } from "@projective/types/explore";
import { invalidQuery, toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/explore/suggest?q=&scope=` — thin route: Zod-validate the typed prefix and scope
 * ({@link SuggestQuerySchema}, 422 on failure), then delegate to the fat
 * {@link ExploreBackendService.suggest}. Backs the `SearchSuggest` typeahead in every discovery bar.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const parsed = SuggestQuerySchema.safeParse({
			q: sp.get("q") ?? "",
			scope: sp.get("scope") || undefined,
		});
		if (!parsed.success) return invalidQuery(parsed.error);
		return toExploreResponse(await ExploreBackendService.suggest(parsed.data));
	},
});
