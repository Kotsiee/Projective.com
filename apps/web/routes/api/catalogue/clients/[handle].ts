import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import {
	clientKeyFromPath,
	invalidQuery,
	parseReadQuery,
} from "@features/catalogue/core/read-query.ts";
import { CatalogueClientsBackendService } from "@server/services/catalogue/CatalogueClientsBackendService.ts";

/**
 * `GET /api/catalogue/clients/<handle>?listing=|scope=` — thin route: auth guard, the handle (a
 * `ClientKey` with its `@` stripped in the path) and the shared read query (Zod), then
 * {@link CatalogueClientsBackendService.client} for the client drawer. A buyer with nothing in scope
 * is a 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const handle = clientKeyFromPath(ctx.params.handle);
		const parsed = parseReadQuery(ctx.url.searchParams);
		if (!handle || !parsed.ok) {
			return invalidQuery({
				...(parsed.ok ? {} : parsed.errors),
				...(handle ? {} : { handle: "Not a client handle." }),
			});
		}
		const { listing, scope, sim } = parsed.query;
		const display = asAuthenticatedContext(ctx.state.userContext).displayCurrency;
		return toCatalogueResponse(
			await CatalogueClientsBackendService.client(
				handle,
				{ listing, filter: scope },
				actor,
				display,
				{ sim },
			),
		);
	},
});
