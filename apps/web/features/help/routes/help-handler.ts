import { HttpError, page } from "fresh";
import {
	type HelpCentreArticle,
	type HelpCentreCategory,
	HelpCentreSearchQuerySchema,
	type HelpCentreSearchResult,
} from "@projective/types/editorial";
import { define } from "@web/utils/state.ts";
import { applyPageMeta, type JsonLdGraph, pageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { HelpBackendService } from "@server/services/editorial/HelpBackendService.ts";
import {
	HELP_ROOT,
	type HelpCentreLibrary,
	type HelpCentreTopic,
} from "@server/services/editorial/help-library.ts";
import { helpSegments, resolveHelpPath } from "../core/help-path.ts";
import {
	articleSeo,
	categorySeo,
	HELP_HUB_DESCRIPTION,
	HELP_HUB_TITLE,
	hubSeo,
} from "../core/help-seo.ts";
import { FEEDBACK_RESULT_PARAM } from "../core/feedback-form.ts";

/**
 * `/help` and `/help/*`'s handler (P2 §1) — kept apart from the page so it loads without an island.
 *
 * Reads the help centre once (`HelpBackendService.snapshot`, cached), resolves the path
 * (`resolveHelpPath`: hub · category · article · a 308 to a canonical path · 404), and sets each
 * page's `<head>` (`pageMeta` on `siteOrigin`) and schema.org graph. `?q=` is honoured on every help
 * page — it opens the search overlay — and on the hub it is also searched here, so a search works
 * with no JavaScript (`<form method="get" action="/help">`); any page carrying `?q=` is `noindex`.
 * An unreadable help centre is a 503 page that says so, never a 404.
 */

// #region Page data
/** What the help page renders. */
export type HelpView =
	| { kind: "hub"; library: HelpCentreLibrary; results?: HelpCentreSearchResult[] }
	| { kind: "category"; topic: HelpCentreTopic }
	| {
		kind: "article";
		library: HelpCentreLibrary;
		article: HelpCentreArticle;
		category: HelpCentreCategory;
		outcome?: "thanks" | "error";
	}
	| { kind: "unavailable" };

/** The help page's data. */
export interface HelpPageData {
	view: HelpView;
	/** The page's structured data (`null` on the unavailable page). */
	graph: JsonLdGraph | null;
	/** The `?q=` the page was requested with, when it carried one. */
	query?: string;
	/** Whether the reader is signed in (the "Still stuck?" band's dispute link). */
	signedIn: boolean;
}
// #endregion

/** The parsed `?q=`, or `undefined` when the request carried none. */
function queryOf(url: URL): string | undefined {
	if (!url.searchParams.has("q")) return undefined;
	return HelpCentreSearchQuerySchema.parse({ q: url.searchParams.get("q") ?? "" }).q;
}

/** The article's `?helpful=` (the no-JavaScript helpfulness answer). */
function outcomeOf(url: URL): "thanks" | "error" | undefined {
	const value = url.searchParams.get(FEEDBACK_RESULT_PARAM);
	return value === "thanks" || value === "error" ? value : undefined;
}

export const handler = define.handlers({
	async GET(ctx) {
		const origin = siteOrigin(ctx.url);
		const query = queryOf(ctx.url);
		const signedIn = ctx.state.isAuthenticated === true;
		const searching = query !== undefined;

		const read = await HelpBackendService.snapshot();
		if (!read.ok || !read.data) {
			applyPageMeta(
				ctx.state,
				pageMeta({
					title: HELP_HUB_TITLE,
					description: HELP_HUB_DESCRIPTION,
					path: HELP_ROOT,
					origin,
					noindex: true,
				}),
			);
			return page<HelpPageData>(
				{ view: { kind: "unavailable" }, graph: null, query, signedIn },
				{ status: read.status >= 500 ? 503 : read.status },
			);
		}

		const { library } = read.data;
		const target = resolveHelpPath(
			helpSegments(ctx.params.path),
			library,
			ctx.url.pathname,
			ctx.url.search,
		);
		switch (target.kind) {
			case "redirect":
				return new Response(null, { status: 308, headers: { location: target.location } });
			case "not-found":
				throw new HttpError(404);
			case "hub": {
				const seo = hubSeo(library, origin, searching);
				applyPageMeta(ctx.state, seo.meta);
				let results: HelpCentreSearchResult[] | undefined;
				if (query) {
					const found = await HelpBackendService.search(query);
					results = found.ok ? found.data?.results : undefined;
				}
				return page<HelpPageData>({
					view: { kind: "hub", library, results },
					graph: seo.graph,
					query,
					signedIn,
				});
			}
			case "category": {
				const seo = categorySeo(target.topic, origin, searching);
				applyPageMeta(ctx.state, seo.meta);
				return page<HelpPageData>({
					view: { kind: "category", topic: target.topic },
					graph: seo.graph,
					query,
					signedIn,
				});
			}
			case "article": {
				const seo = articleSeo(target.article, target.category, origin, searching);
				applyPageMeta(ctx.state, seo.meta);
				return page<HelpPageData>({
					view: {
						kind: "article",
						library,
						article: target.article,
						category: target.category,
						outcome: outcomeOf(ctx.url),
					},
					graph: seo.graph,
					query,
					signedIn,
				});
			}
		}
	},
});
