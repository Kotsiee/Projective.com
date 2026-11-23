import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { clientKey } from "@web/utils/client-key.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import {
	invalid,
	readJsonBody,
	signedOut,
	toCatalogueResponse,
} from "@features/catalogue/core/respond.ts";
import { SavePromoCodeSchema } from "@projective/types/finance";
import { CataloguePromotionsBackendService } from "@server/services/catalogue/CataloguePromotionsBackendService.ts";
import { promoThrottle, retryAfterSeconds } from "@server/services/finance/promo-throttle.ts";

/**
 * `/api/catalogue/promotions` — thin route over the acting seller's promo codes (MARKETPLACE CK2,
 * Decision #485; `?team=` as every catalogue route).
 *
 * `GET` reads the codes and the product listings a code may cover
 * ({@link CataloguePromotionsBackendService.list}). `POST` {@link SavePromoCodeSchema} issues one
 * ({@link CataloguePromotionsBackendService.create}): 201, 403 for a 13–17 account or a member without
 * `publish_listings`, 422 for terms the database refuses, 409 for a code that is taken. Issuing counts
 * against the promo throttle, because "taken" says a code exists: past it, a 429 with `Retry-After`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		return toCatalogueResponse(await CataloguePromotionsBackendService.list(actor));
	},

	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = SavePromoCodeSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		const refused = promoThrottle.admit({
			account: actor.userId,
			clientKey: clientKey(ctx.info.remoteAddr, ctx.req.headers),
		});
		if (refused) {
			const res = toCatalogueResponse(refused);
			res.headers.set("retry-after", String(retryAfterSeconds(refused)));
			return res;
		}
		return toCatalogueResponse(await CataloguePromotionsBackendService.create(parsed.data, actor));
	},
});
