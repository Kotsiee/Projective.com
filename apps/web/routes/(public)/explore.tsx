import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { IS_DEV } from "@web/utils/dev.ts";
import { ensureSession } from "@web/utils/session.ts";
import { resolveTokenContext } from "@web/utils/user-context.ts";
import { ExploreScreen } from "@features/explore/components/ExploreScreen.tsx";
import { isResultsMode, parseExploreParams } from "@features/explore/core/explore-state.ts";
import { DISCOVERY_SIM_COOKIE, parseDiscoverySim } from "@features/explore/core/discovery-sim.ts";
import { rankingHeaders, semanticRankingFor } from "@features/explore/core/discovery-ranking.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { NO_DISCOVERY_SIM } from "@projective/types/explore";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";

/**
 * `/explore` — the dual-layout discovery surface. Thin route: parse the URL query into
 * `ExploreParams`, resolve the first-paint data from the fat {@link ExploreBackendService} (the Home
 * feed for State A, or the initial search page for State B), set SEO, and hand both to
 * {@link ExploreScreen}. Islands refine client-side via `ExploreService`; the route never touches the
 * fixtures directly.
 *
 * The Home feed is personalised for a signed-in reader, so a lapsed session is renewed in place first
 * — the same move `[handle]/_middleware.ts` makes — rather than serving a returning reader a guest's
 * page. The Dev Context Switcher's cold-start simulation rides in on its cookie, in development only.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const session = await ensureSession(ctx.req);
		if (session.authenticated && session.accessToken) {
			ctx.state.accessToken = session.accessToken;
			if (session.refreshed) {
				ctx.state.isAuthenticated = true;
				ctx.state.userContext = resolveTokenContext(session.accessToken);
			}
		}
		const headers = [...session.setCookies, ...session.clearCookies].map((
			cookie,
		): [string, string] => ["set-cookie", cookie]);

		const params = parseExploreParams(ctx.url.searchParams);
		const authed = ctx.state.isAuthenticated ?? false;
		const viewerFreelancer = ctx.state.userContext?.isFreelancer ?? false;
		const viewerRestricted = isRestrictedRequest(ctx.req, ctx.state.userContext);

		if (isResultsMode(params)) {
			const label = params.q || params.category;
			ctx.state.title = `${label} · Explore · Projective`;
			ctx.state.description = `Search results for ${label} on Projective.`;
			const res = await ExploreBackendService.search({
				params,
				actor: readActor(ctx),
				semantic: semanticRankingFor(ctx.req),
			});
			return page({
				params,
				initial: res.ok ? res.data : undefined,
				home: undefined,
				authed,
				viewerFreelancer,
				viewerRestricted,
			}, { headers: [...headers, ...rankingHeaders(res.ranking)] });
		}

		ctx.state.title = "Explore · Projective";
		ctx.state.description =
			"Discover freelancers, teams, services, projects, products, and guides on Projective.";
		const sim = IS_DEV
			? parseDiscoverySim(readCookies(ctx.req)[DISCOVERY_SIM_COOKIE])
			: NO_DISCOVERY_SIM;
		const res = await ExploreBackendService.home({ actor: readActor(ctx), sim });
		return page({
			params,
			initial: undefined,
			home: res.ok ? res.data : undefined,
			authed,
			viewerFreelancer,
			viewerRestricted,
		}, { headers: [...headers, ...rankingHeaders("heuristic")] });
	},
});

export default define.page<typeof handler>(function ExplorePage({ data }) {
	return (
		<ExploreScreen
			params={data.params}
			home={data.home}
			initial={data.initial}
			authed={data.authed}
			viewerFreelancer={data.viewerFreelancer}
			viewerRestricted={data.viewerRestricted}
		/>
	);
});
