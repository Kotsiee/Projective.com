import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { invalidQuery, parseReadQuery } from "@features/catalogue/core/read-query.ts";
import { CatalogueClientsBackendService } from "@server/services/catalogue/CatalogueClientsBackendService.ts";

/**
 * `GET /api/catalogue/waitlist?listing=` — thin route: auth guard, the shared read query (Zod), then
 * {@link CatalogueClientsBackendService.waitlist} for one group-session listing's queue (the
 * workspace's Clients tab, Decision #455). `sim` is the `clientPipeline` dev axis, honoured only by the
 * fixture path.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = parseReadQuery(ctx.url.searchParams);
		if (!parsed.ok) return invalidQuery(parsed.errors);
		const { listing, sim } = parsed.query;
		if (!listing) return invalidQuery({ listing: "Name the listing." });
		return toCatalogueResponse(
			await CatalogueClientsBackendService.waitlist(listing, actor, { sim }),
		);
	},
});
