import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import type { AnalyticsScope } from "@projective/types/catalogue";
import { readActor } from "@web/utils/api-session.ts";
import { signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { invalidQuery, parseReadQuery } from "@features/catalogue/core/read-query.ts";
import { CatalogueAnalyticsBackendService } from "@server/services/catalogue/CatalogueAnalyticsBackendService.ts";

/**
 * `GET /api/catalogue/analytics?listing=|scope=&period=` — thin route: auth guard, the shared read
 * query (Zod), then {@link CatalogueAnalyticsBackendService.overview} for one listing (`listing`, the
 * workspace's Analytics tab) or a console scope (`scope`, the console's Analytics view). `sim` is the
 * `catalogueAnalytics` dev axis, honoured only by the fixture path.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = parseReadQuery(ctx.url.searchParams);
		if (!parsed.ok) return invalidQuery(parsed.errors);
		const { listing, scope, period, sim } = parsed.query;
		const target: AnalyticsScope = listing
			? { kind: "listing", listingId: listing }
			: { kind: "catalogue", filter: scope };
		const display = asAuthenticatedContext(ctx.state.userContext).displayCurrency;
		return toCatalogueResponse(
			await CatalogueAnalyticsBackendService.overview(target, period, actor, display, { sim }),
		);
	},
});
