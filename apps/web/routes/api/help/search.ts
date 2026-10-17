import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { HelpCentreSearchQuerySchema } from "@projective/types/editorial";
import { HelpBackendService } from "@server/services/editorial/HelpBackendService.ts";

/**
 * `GET /api/help/search?q=` — the help centre's search (P2). Thin route: parse `q`
 * (`HelpCentreSearchQuerySchema`: trimmed, cut to 120 characters, empty allowed) and hand it to
 * {@link HelpBackendService.search}, answering the flat envelope
 * `{ ok, query, results: [{ slug, title, category, categoryTitle, href, snippet, highlights }] }`.
 * Public and the same for every reader, so a minute of shared caching is safe.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const parsed = HelpCentreSearchQuerySchema.safeParse({
			q: ctx.url.searchParams.get("q") ?? "",
		});
		const query = parsed.success ? parsed.data.q : "";
		const res = serviceResponse(await HelpBackendService.search(query));
		if (res.ok) res.headers.set("cache-control", "public, max-age=60");
		return res;
	},
});
