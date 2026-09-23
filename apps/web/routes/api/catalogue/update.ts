import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateListingInputSchema } from "@projective/types/catalogue";
import { toCatalogueResponse, toFieldErrors } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/update` — thin route: Zod-validate the Update-Listing patch (a partial over the
 * editable body), then delegate to the fat {@link CatalogueBackendService.update}, which saves the
 * listing and its product or service blueprint together (`catalogue.save_listing`) as the seller who
 * created it. The editor calls this on debounced autosave + manual save.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpdateListingInputSchema.safeParse(raw);
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
		return toCatalogueResponse(await CatalogueBackendService.update(parsed.data, readActor(ctx)));
	},
});
