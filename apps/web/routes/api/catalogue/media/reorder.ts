import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { ReorderListingMediaSchema } from "@projective/types/catalogue";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/media/reorder` — thin route: move a listing's showcase items between their
 * filled slots. Auth guard, Zod, then {@link CatalogueBackendService.reorderMedia}, which refuses a
 * video in the cover slot.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = ReorderListingMediaSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueBackendService.reorderMedia(parsed.data, actor));
	},
});
