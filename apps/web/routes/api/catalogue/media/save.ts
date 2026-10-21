import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { SaveListingShowcaseSchema } from "@projective/types/catalogue";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/media/save` — thin route: save a listing's showcase as a whole (empty a slot
 * or edit an item's alt text). Auth guard, Zod, then {@link CatalogueBackendService.saveShowcase},
 * which keeps only items already in the showcase and refuses a video in the cover slot.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = SaveListingShowcaseSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueBackendService.saveShowcase(parsed.data, actor));
	},
});
