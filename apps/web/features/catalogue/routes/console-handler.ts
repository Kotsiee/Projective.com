import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toDisplayCurrency } from "@projective/types/finance";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleParamsOf, resolveCataloguePage } from "../core/catalogue-ssr.ts";
import { parseConsoleUrl, scopeRedirect } from "../types/catalogue-types.ts";

/**
 * The `/catalogue` console's handler (plan §3.1), apart from its page so it loads without the
 * islands' stylesheets. A console scoped to one listing (`?scope=svc-…`) belongs to that listing's
 * workspace and is sent there with a 303 (Decision #217(l)); otherwise the URL is parsed and the
 * listings page for it is read as the signed-in seller (analytics and clients are fetched by the
 * canvas after first paint). A read that failed is a 503 that paints the error state, never an empty
 * catalogue.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const target = scopeRedirect(ctx.url);
		if (target) return new Response(null, { status: 303, headers: { location: target } });

		const context = asAuthenticatedContext(ctx.state.userContext);
		const { page: listings, error } = await resolveCataloguePage(
			context,
			ctx.url,
			readActor(ctx),
			consoleParamsOf(ctx.url),
		);
		ctx.state.title = "Catalogue · Projective";
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
