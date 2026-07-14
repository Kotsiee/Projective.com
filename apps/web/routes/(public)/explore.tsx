import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { ExploreScreen } from "@features/explore/components/ExploreScreen.tsx";
import { isResultsMode, parseExploreParams } from "@features/explore/core/explore-state.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `/explore` — the dual-layout discovery surface. Thin route: parse the URL query into
 * `ExploreParams`, resolve the first-paint data from the fat {@link ExploreBackendService} (the Home
 * feed for State A, or the initial search page for State B), set SEO, and hand both to
 * {@link ExploreScreen}. Islands refine client-side via `ExploreService`; the route never touches the
 * fixtures directly.
 */
export const handler = define.handlers({
	GET(ctx) {
		const params = parseExploreParams(ctx.url.searchParams);
		const authed = ctx.state.isAuthenticated ?? false;

		if (isResultsMode(params)) {
			const label = params.q || params.category;
			ctx.state.title = `${label} · Explore · Projective`;
			ctx.state.description = `Search results for ${label} on Projective.`;
			const res = ExploreBackendService.search({ params });
			return page({ params, initial: res.ok ? res.data : undefined, home: undefined, authed });
		}

		ctx.state.title = "Explore · Projective";
		ctx.state.description =
			"Discover freelancers, teams, services, projects, products, and guides on Projective.";
		const res = ExploreBackendService.home();
		return page({ params, initial: undefined, home: res.ok ? res.data : undefined, authed });
	},
});

export default define.page<typeof handler>(function ExplorePage({ data }) {
	return (
		<ExploreScreen
			params={data.params}
			home={data.home}
			initial={data.initial}
			authed={data.authed}
		/>
	);
});
