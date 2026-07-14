import { define } from "@web/utils/state.ts";
import { toExploreResponse } from "@features/explore/core/respond.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `GET /api/explore/item?id=…` — thin route: look up a single discovery item by id via the fat
 * service (404 when unknown). Backs the detail drawer's client refresh and any deep-link prefetch.
 */
export const handler = define.handlers({
	GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) {
			return Response.json({ ok: false, message: "Missing item id." }, { status: 400 });
		}
		return toExploreResponse(ExploreBackendService.item(id));
	},
});
