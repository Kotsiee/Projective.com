import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toDisplayCurrency } from "@projective/types/finance";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleParamsOf, resolveCataloguePage } from "../core/catalogue-ssr.ts";
import { routeSellerScope } from "../core/seller-scope.ts";
import { parseConsoleUrl, scopeRedirect } from "../types/catalogue-types.ts";

/**
 * The `/catalogue` console's handler (plan §3.1), apart from its page so it loads without the
 * islands' stylesheets. A console scoped to one listing (`?scope=svc-…`) belongs to that listing's
 * workspace and is sent there with a 303 (Decision #217(l)); otherwise the URL is parsed and the
 * listings page for it is read as the signed-in seller (analytics and clients are fetched by the
 * canvas after first paint). A read that failed is a 503 that paints the error state, never an empty
 * catalogue.
 *
 * `/teams/[teamHandle]/catalogue` re-exports the same page (Decision #312): the team console decides
 * the address first (`routeSellerScope` — a canonical handle, membership, `publish_listings`), and the
 * page is then read as the team, whatever context the viewer is acting in.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const scope = await routeSellerScope(ctx.params.teamHandle, ctx.url, readActor(ctx));
		if (scope instanceof Response) return scope;

		const target = scopeRedirect(ctx.url);
		if (target) return new Response(null, { status: 303, headers: { location: target } });

		const context = asAuthenticatedContext(ctx.state.userContext);
		const { page: listings, error } = await resolveCataloguePage(
			context,
			ctx.url,
			scope.actor,
			consoleParamsOf(ctx.url),
		);
		ctx.state.title = scope.team ? `Catalogue · ${scope.team.name}` : "Catalogue · Projective";
		return page(
			{
				listings,
				error,
				url: parseConsoleUrl(ctx.url),
				defaultCurrency: toDisplayCurrency(context.displayCurrency),
			},
			error ? { status: 503 } : undefined,
		);
	},
});
