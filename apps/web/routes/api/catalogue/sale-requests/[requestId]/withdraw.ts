import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { uuid } from "@projective/types/finance";
import { toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { SaleRequestBackendService } from "@server/services/catalogue/SaleRequestBackendService.ts";

/**
 * `POST /api/catalogue/sale-requests/[requestId]/withdraw` — the maker withdraws an open request to
 * sell (MARKETPLACE SC7, ROUTING.md). Thin: the id, then {@link SaleRequestBackendService.withdraw}
 * (`catalogue.withdraw_sale_request`, as the signed-in maker).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.requestId);
		if (!id.success) {
			return Response.json({ ok: false, message: "That request to sell doesn't exist." }, {
				status: 404,
			});
		}
		return toCatalogueResponse(await SaleRequestBackendService.withdraw(id.data, readActor(ctx)));
	},
});
