import { define } from "@web/utils/state.ts";
import { suggestedTags, SuggestTagsQuerySchema } from "@projective/types/catalogue";
import { invalidQuery, toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/search/suggest-tags?q=` — thin route: the search tags to offer while a seller types
 * one. Zod-validates the prefix, asks the fat {@link ExploreBackendService.suggest} (the discovery
 * typeahead, across every category), and answers with the skills and categories it matched as tags.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const parsed = SuggestTagsQuerySchema.safeParse({ q: ctx.url.searchParams.get("q") ?? "" });
		if (!parsed.success) return invalidQuery(parsed.error);
		const result = await ExploreBackendService.suggest({ q: parsed.data.q, scope: "all" });
		if (!result.ok || !result.data) return toExploreResponse(result);
		return toExploreResponse({ ...result, data: { tags: suggestedTags(result.data) } });
	},
});
