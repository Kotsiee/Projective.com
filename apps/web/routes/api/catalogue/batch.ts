import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { BatchInputSchema } from "@projective/types/catalogue";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";

/**
 * `POST /api/catalogue/batch` — thin route: one action (status, add to a collection, duplicate) over up
 * to 100 listings. Auth guard, Zod, the age gate when the action publishes (Decision #190; the
 * database's publish trigger refuses the same rows), then {@link CatalogueBackendService.batch}, which
 * answers one outcome per listing.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = BatchInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		if (parsed.data.action === "status" && parsed.data.status === "published") {
			const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
			if (restricted) return restricted;
		}
		return toCatalogueResponse(await CatalogueBackendService.batch(parsed.data, actor));
	},
});
