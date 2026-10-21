import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { DuplicateListingInputSchema } from "@projective/types/catalogue";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/duplicate` — thin route: copy one of the seller's listings as a new draft.
 * Auth guard, Zod, then {@link CatalogueBackendService.duplicate}; answers `201` with the copy.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = DuplicateListingInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueBackendService.duplicate(parsed.data.id, actor));
	},
});
