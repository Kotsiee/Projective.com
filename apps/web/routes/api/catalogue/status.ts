import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SetListingStatusInputSchema } from "@projective/types/catalogue";
import { toCatalogueResponse, toFieldErrors } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/status` — thin route: Zod-validate the Set-Status payload, then delegate to the
 * fat {@link CatalogueBackendService.setStatus} (publish / pause / archive / restore), as the seller who
 * created the listing. A `published` transition runs the publish gate in the database (title + a price +
 * ≥1 image) and comes back as a `422` naming what is missing — the same gate the page shows.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SetListingStatusInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Invalid status change.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		return toCatalogueResponse(await CatalogueBackendService.setStatus(parsed.data, readActor(ctx)));
	},
});
