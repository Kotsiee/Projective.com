import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ApplyListingMediaSchema } from "@projective/types/catalogue";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/media` — thin route: place up to six library assets into a listing's showcase.
 * Auth guard, Zod, then the fat {@link CatalogueBackendService.applyMedia}, which cuts each 16:10
 * rendition and writes the showcase (slot 1 a still, mirrored to the cover) as the seller.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = ApplyListingMediaSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueBackendService.applyMedia(parsed.data, actor));
	},
});
