import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `/api/catalogue/item?id=svc-…|prd-…` — thin route over one listing, as the signed-in seller.
 *
 * `GET` delegates to the fat {@link CatalogueBackendService.detail} for its full editable detail (a
 * listing that is not theirs answers 404). `DELETE` hard-deletes it through
 * {@link CatalogueBackendService.remove} — only a listing with no buyer history; one with history
 * answers 409 and is archived instead, through `POST /api/catalogue/status` (Decision #221). Islands
 * reach both via the dumb `CatalogueService`.
 */
function idOf(url: URL): string | null {
	const id = url.searchParams.get("id");
	return id && id.length <= 120 ? id : null;
}

const MISSING_ID = () => Response.json({ ok: false, message: "Missing id." }, { status: 400 });

export const handler = define.handlers({
	async GET(ctx) {
		const id = idOf(ctx.url);
		if (!id) return MISSING_ID();
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		return toCatalogueResponse(await CatalogueBackendService.detail(id, actor));
	},

	async DELETE(ctx) {
		const id = idOf(ctx.url);
		if (!id) return MISSING_ID();
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		return toCatalogueResponse(await CatalogueBackendService.remove(id, actor));
	},
});
