import { page } from "fresh";
import type { LandingHero, LandingPayload } from "@projective/types/explore";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { PublicMetricsService } from "@server/services/marketing/PublicMetricsService.ts";
import { define } from "@web/utils/state.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { LandingPage, landingPageMeta } from "@features/landing/routes/LandingPage.tsx";
import { tkvRedirect } from "@features/landing/core/strip-tkv.ts";
import { heroViewerOf } from "@features/landing/core/hero-search.ts";
import { DEMO_PARAM, parseDemoId } from "@features/landing/core/demo-stage.ts";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";

/** The hero search when its read failed: no typewriter examples, no Trending rows, no chips. */
const NO_HERO_SEARCH: LandingHero = { terms: [], trending: [], chips: [] };

/**
 * Public landing route (thin controller). A `?tkv=` ticket deep link is answered first with a 303 to
 * the same address without it (`tkvRedirect`, Decision #286 (A)). Otherwise it puts the page's head
 * facts on request state — the root `_app` renders them into `<head>` — and reads, through the fat
 * discovery service, the live marketplace and the hero search's data (`landingHero`: the trending
 * terms, the typewriter's confirmed examples and the "Try:" chips), and, through the public metrics
 * service, the platform fee every simulated payout uses (`platformFeeBp`). The calls to action read
 * three viewer facts, never the whole context; "restricted" honours the Dev Context Switcher's age
 * override as every public surface does (`isRestrictedRequest`). `?demo=` names the demo stage's
 * open tab, so a deep link renders it open with no JavaScript. A failed read renders the page with
 * that part withheld rather than an error document — a missing fee drops every fee clause — since
 * the landing's story does not depend on the database being up.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const redirect = tkvRedirect(ctx.url);
		if (redirect) return redirect;
		const origin = siteOrigin(ctx.url);
		applyPageMeta(ctx.state, landingPageMeta(origin));
		const [res, search, metrics] = await Promise.all([
			ExploreBackendService.landing(),
			ExploreBackendService.landingHero(),
			PublicMetricsService.get(),
		]);
		const landing: LandingPayload | null = res.ok && res.data ? res.data : null;
		const feeBp = metrics.ok && metrics.data ? metrics.data.platformFeeBp : null;
		const context = ctx.state.userContext;
		const viewer = heroViewerOf(
			ctx.state.isAuthenticated === true,
			context
				? {
					isFreelancer: context.isFreelancer === true,
					restricted: isRestrictedRequest(ctx.req, context),
				}
				: null,
		);
		return page({
			landing,
			origin,
			hero: { ...(search.ok && search.data ? search.data : NO_HERO_SEARCH), viewer },
			feeBp,
			demo: parseDemoId(ctx.url.searchParams.get(DEMO_PARAM)),
		});
	},
});

export default define.page<typeof handler>(function LandingRoute({ data }) {
	return (
		<LandingPage
			landing={data.landing}
			origin={data.origin}
			hero={data.hero}
			feeBp={data.feeBp}
			demo={data.demo}
		/>
	);
});
