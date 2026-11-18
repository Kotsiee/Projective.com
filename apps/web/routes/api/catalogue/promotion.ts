import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { PromoteListingInputSchema } from "@projective/types/catalogue";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `/api/catalogue/promotion?id=svc-…|prd-…` — thin route over one listing's promoted placement, as
 * the signed-in seller (Decision #454).
 *
 * `GET` reads what the Promote control shows ({@link CatalogueBackendService.promotion}). `POST`
 * `{ id, surface }` starts the seller's one plan-allocated 7-day flight
 * ({@link CatalogueBackendService.promote}): 403 for a 13–17 account, 402 without the plan, 409 with a
 * flight already live. `DELETE` stops the listing's live flight
 * ({@link CatalogueBackendService.stopPromotion}). Islands reach all three via the dumb
 * `CatalogueService`.
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
		return toCatalogueResponse(await CatalogueBackendService.promotion(id, actor));
	},

	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = PromoteListingInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueBackendService.promote(parsed.data, actor));
	},

	async DELETE(ctx) {
		const id = idOf(ctx.url);
		if (!id) return MISSING_ID();
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		return toCatalogueResponse(await CatalogueBackendService.stopPromotion(id, actor));
	},
});
