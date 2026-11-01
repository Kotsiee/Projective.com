import { type Context, page } from "fresh";
import { define, type State } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { IS_DEV } from "@web/utils/dev.ts";
import { ensureSession, type SessionState } from "@web/utils/session.ts";
import { resolveTokenContext } from "@web/utils/user-context.ts";
import { ExploreScreen } from "@features/explore/components/ExploreScreen.tsx";
import { isResultsMode, parseExploreParams } from "@features/explore/core/explore-state.ts";
import { DISCOVERY_SIM_COOKIE, parseDiscoverySim } from "@features/explore/core/discovery-sim.ts";
import { rankingHeaders, semanticRankingFor } from "@features/explore/core/discovery-ranking.ts";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { NO_DISCOVERY_SIM } from "@projective/types/explore";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { applyPageMeta, pageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";

// #region Controller
/** The `set-cookie` pairs a {@link SessionState} asks the response to carry (renewed or wiped tokens). */
export function sessionCookieHeaders(session: SessionState): [string, string][] {
	return [...session.setCookies, ...session.clearCookies].map((cookie) => ["set-cookie", cookie]);
}

/**
 * The discovery surface's response, shared by `/explore` and the guest front page `/` (Decision
 * #349). Parse the URL query into `ExploreParams`, resolve the first-paint data from the fat
 * {@link ExploreBackendService} (the Home feed for State A, or the initial search page for State B),
 * set the head copy, and hand both to {@link ExploreScreen}. Islands refine client-side via
 * `ExploreService`; the controller never touches the fixtures directly.
 *
 * The Home feed is personalised for a signed-in reader, so the caller renews a lapsed session first
 * — the same move `[handle]/_middleware.ts` makes — and passes the result in, rather than serving a
 * returning reader a guest's page. The Dev Context Switcher's cold-start simulation rides in on its
 * cookie, in development only.
 */
export async function exploreResponse(ctx: Context<State>, session: SessionState) {
	if (session.authenticated && session.accessToken) {
		ctx.state.accessToken = session.accessToken;
		if (session.refreshed) {
			ctx.state.isAuthenticated = true;
			ctx.state.userContext = resolveTokenContext(session.accessToken);
		}
	}
	const headers = sessionCookieHeaders(session);

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

	// The guest front page `/` prints this same Home, so `/` is its one canonical address.
	applyPageMeta(
		ctx.state,
		pageMeta({
			title: "Explore",
			description:
				"Discover freelancers, teams, services, projects, products, and guides on Projective.",
			path: "/",
			origin: siteOrigin(ctx.url),
		}),
	);
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
}

/** `/explore` — the discovery surface for every audience; see {@link exploreResponse}. */
export const handler = define.handlers({
	async GET(ctx) {
		return exploreResponse(ctx, await ensureSession(ctx.req));
	},
});

/** The page both `/explore` and `/` render: {@link ExploreScreen} over the handler's first paint. */
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
// #endregion
