import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateListingInputSchema } from "@projective/types/catalogue";
import { toCatalogueResponse, toFieldErrors } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/create` — thin route: Zod-validate the Create-Listing payload (title + kind, plus
 * a delivery model for services), map issues to field errors, then delegate to the fat
 * {@link CatalogueBackendService.create}, which creates the draft and its product or service blueprint
 * in one transaction as the signed-in seller (`catalogue.create_listing`; only a freelancer can sell a
 * service). Returns the draft so the client routes to `/catalogue/[id]`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateListingInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Check the highlighted fields.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toCatalogueResponse(await CatalogueBackendService.create(parsed.data, readActor(ctx)));
	},
});
