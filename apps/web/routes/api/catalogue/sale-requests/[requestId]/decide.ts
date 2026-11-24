import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DecideSaleRequestInputSchema } from "@projective/types/catalogue";
import { uuid } from "@projective/types/finance";
import { invalid, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { SaleRequestBackendService } from "@server/services/catalogue/SaleRequestBackendService.ts";

/**
 * `POST /api/catalogue/sale-requests/[requestId]/decide` `{ approve, fileIds?, note? }` — the client
 * grants a request to sell (some or all of its files) or declines it (MARKETPLACE SC7, ROUTING.md).
 * Thin: Zod, then {@link SaleRequestBackendService.decide} (`catalogue.decide_sale_request`, as the
 * signed-in client). ⚖️ A grant answers 409 until counsel's licence wording switches grants on.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const id = uuid.safeParse(ctx.params.requestId);
		if (!id.success) {
			return Response.json({ ok: false, message: "That request to sell doesn't exist." }, {
				status: 404,
			});
		}
		const parsed = DecideSaleRequestInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(
			await SaleRequestBackendService.decide(id.data, parsed.data, readActor(ctx)),
		);
	},
});
