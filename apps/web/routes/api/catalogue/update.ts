import { define } from "@web/utils/state.ts";
import { UpdateListingInputSchema } from "@projective/types/catalogue";
import { toCatalogueResponse, toFieldErrors } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/update` — thin route: Zod-validate the Update-Listing patch (a partial over the
 * editable body), then delegate to the fat {@link CatalogueBackendService.update}. No server capability
 * guard (Dev Context Switcher reachability; seller-ness is chrome + deferred RLS). The editor calls this
 * on debounced autosave + manual save; persistence is stubbed until `CATALOGUE_BACKEND_LIVE` lands.
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
		return toCatalogueResponse(CatalogueBackendService.update(parsed.data));
	},
});
