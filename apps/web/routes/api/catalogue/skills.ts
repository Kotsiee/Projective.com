import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `GET /api/catalogue/skills?q=` — thin route: the `org.skills` labels a seller can tag a listing
 * with, matching what they typed. Auth guard, then {@link CatalogueBackendService.skills}; the
 * query is free text, so a long one is simply cut to the longest skill label.
 */
export const handler = define.handlers({
	async GET(ctx) {
		if (!readActor(ctx).userId) return signedOut();
		const q = (ctx.url.searchParams.get("q") ?? "").slice(0, 80);
		return toCatalogueResponse(await CatalogueBackendService.skills(q));
	},
});
