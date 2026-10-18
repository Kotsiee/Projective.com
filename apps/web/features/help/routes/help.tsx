import { define } from "@web/utils/state.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import HelpSearch from "../islands/HelpSearch.island.tsx";
import { HelpHubPage } from "../hub/components/HelpHubPage.tsx";
import { HelpCategoryPage } from "../category/components/HelpCategoryPage.tsx";
import { HelpArticlePage } from "../article/components/HelpArticlePage.tsx";
import { HelpStillStuck } from "../components/HelpStillStuck.tsx";
import { HELP_HUB_TITLE } from "../core/help-seo.ts";
import { handler, type HelpPageData } from "./help-handler.ts";

/**
 * The help centre's page (P2), re-exported by `routes/(public)/help/[...path].tsx`: the hub, a
 * category or an article, as {@link handler} resolved it, with its JSON-LD.
 */
export { handler };

export default define.page<typeof handler>(function HelpPage({ data }) {
	const { view, graph, query, signedIn } = data as HelpPageData;
	return (
		<>
			{view.kind === "hub" && (
				<HelpHubPage
					library={view.library}
					query={query}
					results={view.results}
					signedIn={signedIn}
				/>
			)}
			{view.kind === "category" && (
				<HelpCategoryPage topic={view.topic} query={query} signedIn={signedIn} />
			)}
			{view.kind === "article" && (
				<HelpArticlePage
					library={view.library}
					article={view.article}
					category={view.category}
					query={query}
					outcome={view.outcome}
				/>
			)}
			{view.kind === "unavailable" && (
				<div class="hc hc--unavailable">
					<p class="hc-eyebrow">{HELP_HUB_TITLE}</p>
					<h1 class="hc-title">The help centre is unavailable right now</h1>
					<p class="hc-lead">
						We couldn't load the help articles. Please try again in a few minutes.
					</p>
					<HelpSearch variant="hero" />
					<HelpStillStuck signedIn={signedIn} />
				</div>
			)}
			{graph && <JsonLd graph={graph} />}
		</>
	);
});
