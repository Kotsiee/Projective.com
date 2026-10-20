import { page } from "fresh";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { PublicMetricsService } from "@server/services/marketing/PublicMetricsService.ts";
import { define } from "@web/utils/state.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { FeaturesPage, featuresPageMeta } from "@features/landing/routes/FeaturesPage.tsx";
import { tkvRedirect } from "@features/landing/core/strip-tkv.ts";
import { heroViewerOf } from "@features/landing/core/hero-search.ts";
import { parseSection, SECTION_PARAM } from "@features/landing/core/features-catalogue.ts";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";

/**
 * `/features` — the "everything Projective does" chapter index (thin controller; `flows/LANDING.md`
 * §2.5, §2.6, §4.12, work order L5). A `?tkv=` ticket deep link is answered first with a 303 to the
 * same address without it (`tkvRedirect`, Decision #286 (A)). Otherwise it puts the page's head facts
 * on request state (the §4.12 title and description, canonical `/features` with no query), reads the
 * platform fee through the public metrics service (the stills and demos print every fee clause from
 * it, and drop them when the read fails) and the final search's trending terms through the discovery
 * service, and hands the page the chapter `?section=` names (an unknown value names none). The final
 * call to action reads three viewer facts, never the whole context, exactly as `/` does. A failed read
 * renders the page with that part withheld, never an error document.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const redirect = tkvRedirect(ctx.url);
		if (redirect) return redirect;
		const origin = siteOrigin(ctx.url);
		applyPageMeta(ctx.state, featuresPageMeta(origin));
		const [search, metrics] = await Promise.all([
			ExploreBackendService.landingHero(),
			PublicMetricsService.get(),
		]);
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
			origin,
			feeBp: metrics.ok && metrics.data ? metrics.data.platformFeeBp : null,
			hero: {
				terms: search.ok && search.data ? search.data.terms : [],
				trending: search.ok && search.data ? search.data.trending : [],
				viewer,
			},
			section: parseSection(ctx.url.searchParams.get(SECTION_PARAM)),
		});
	},
});

export default define.page<typeof handler>(function FeaturesRoute({ data }) {
	return (
		<FeaturesPage
			origin={data.origin}
			feeBp={data.feeBp}
			hero={data.hero}
			section={data.section}
		/>
	);
});
