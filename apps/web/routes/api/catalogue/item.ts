import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `GET /api/catalogue/item?id=svc-…|prd-…` — thin route: delegate to the fat
 * {@link CatalogueBackendService.detail} for a single listing's full editable detail (the manage page),
 * read as the signed-in seller — a listing that is not theirs answers 404. Islands fetch this via the
 * dumb `CatalogueService.detail`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) return Response.json({ ok: false, message: "Missing id." }, { status: 400 });
		return toCatalogueResponse(await CatalogueBackendService.detail(id, readActor(ctx)));
	},
});
