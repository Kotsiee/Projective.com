import { define } from "@web/utils/state.ts";
import { toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `GET /api/catalogue/item?id=…` — thin route: delegate to the fat
 * {@link CatalogueBackendService.detail} for a single listing's full editable detail (the manage page).
 * No server capability guard (the Dev Context Switcher must reach the seller surface — seller-ness is
 * chrome + deferred RLS). Islands fetch this via the dumb `CatalogueService.detail`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) return Response.json({ ok: false, message: "Missing id." }, { status: 400 });
		return toCatalogueResponse(CatalogueBackendService.detail(id));
	},
});
