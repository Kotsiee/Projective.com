import { define } from "@web/utils/state.ts";
import { CreateListingInputSchema } from "@projective/types/catalogue";
import { toCatalogueResponse, toFieldErrors } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/create` — thin route: Zod-validate the Create-Listing payload (title + kind, plus
 * a delivery model for services), map issues to field errors, then delegate to the fat
 * {@link CatalogueBackendService.create}. No server capability guard — the Dev Context Switcher must be
 * able to create as a simulated seller (seller-ness is chrome + deferred RLS + mutation policies, the
 * live-path TODO). Returns the optimistic Draft so the client routes to `/catalogue/[id]`. Persistence is
 * stubbed (a session store) until `CATALOGUE_BACKEND_LIVE` lands.
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
		return toCatalogueResponse(CatalogueBackendService.create(parsed.data));
	},
});
