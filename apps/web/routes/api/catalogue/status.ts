import { define } from "@web/utils/state.ts";
import { SetListingStatusInputSchema } from "@projective/types/catalogue";
import { toCatalogueResponse, toFieldErrors } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/status` — thin route: Zod-validate the Set-Status payload, then delegate to the
 * fat {@link CatalogueBackendService.setStatus} (publish / pause / archive / restore). No server
 * capability guard (Dev Context Switcher reachability; seller-ness is chrome + deferred RLS). A
 * `published` transition runs the publish gate server-side (title + a price + ≥1 media) and comes back
 * as a `422` with the missing pieces when unmet — defence in depth over the client-side gate.
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
		return toCatalogueResponse(CatalogueBackendService.setStatus(parsed.data));
	},
});
