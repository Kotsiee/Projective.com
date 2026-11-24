import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RequestSaleInputSchema } from "@projective/types/catalogue";
import { invalid, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { SaleRequestBackendService } from "@server/services/catalogue/SaleRequestBackendService.ts";

/**
 * `POST /api/catalogue/sale-requests` `{ stageId, title, fileIds, royaltyBp, note? }` — ask to sell an
 * asset made on a released stage (MARKETPLACE SC7, ROUTING.md). Thin: Zod, then
 * {@link SaleRequestBackendService.request}, which calls `catalogue.request_sale` as the signed-in maker;
 * the door decides who may ask and on which stage.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = RequestSaleInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(
			await SaleRequestBackendService.request(parsed.data, readActor(ctx)),
		);
	},
});
