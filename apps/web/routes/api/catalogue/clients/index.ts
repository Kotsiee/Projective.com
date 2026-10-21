import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { invalidQuery, parseReadQuery } from "@features/catalogue/core/read-query.ts";
import { CatalogueClientsBackendService } from "@server/services/catalogue/CatalogueClientsBackendService.ts";

/**
 * `GET /api/catalogue/clients?listing=|scope=` — thin route: auth guard, the shared read query (Zod),
 * then {@link CatalogueClientsBackendService.pipeline} for one listing's buyers (the workspace's
 * Clients tab) or a console scope's (the console's Clients view). `sim` is the `clientPipeline` dev
 * axis, honoured only by the fixture path.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = parseReadQuery(ctx.url.searchParams);
		if (!parsed.ok) return invalidQuery(parsed.errors);
		const { listing, scope, sim } = parsed.query;
		const display = asAuthenticatedContext(ctx.state.userContext).displayCurrency;
		return toCatalogueResponse(
			await CatalogueClientsBackendService.pipeline({ listing, filter: scope }, actor, display, {
				sim,
			}),
		);
	},
});
