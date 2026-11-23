import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import {
	invalid,
	readJsonBody,
	signedOut,
	toCatalogueResponse,
} from "@features/catalogue/core/respond.ts";
import { ArchivePromoCodeSchema } from "@projective/types/finance";
import { CataloguePromotionsBackendService } from "@server/services/catalogue/CataloguePromotionsBackendService.ts";

/**
 * `POST /api/catalogue/promotions/archive` {@link ArchivePromoCodeSchema} — archive one of the acting
 * seller's promo codes (MARKETPLACE CK2, Decision #485; `?team=` as every catalogue route). It stops
 * applying at once and stays listed; nothing is deleted. Idempotent; 404 for a code that is not the
 * seller's ({@link CataloguePromotionsBackendService.archive}).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = ArchivePromoCodeSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(
			await CataloguePromotionsBackendService.archive(parsed.data.id, actor),
		);
	},
});
