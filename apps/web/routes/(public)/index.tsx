import { page } from "fresh";
import type { LandingPayload } from "@projective/types/explore";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { define } from "@web/utils/state.ts";
import { LandingPage, landingPageMeta } from "@features/landing/routes/LandingPage.tsx";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";

/**
 * Public landing route (thin controller). Puts the page's head facts on request state — the root
 * `_app` renders them into `<head>` — reads the live marketplace once through the fat discovery
 * service, and delegates the page to the `@features/landing` controller, which the `(public)`
 * layout wraps in LandingShell. A failed read renders the page with the listings withheld
 * (`landing: null`) rather than an error document: the landing's story does not depend on the
 * database being up.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const origin = siteOrigin(ctx.url);
		applyPageMeta(ctx.state, landingPageMeta(origin));
		const res = await ExploreBackendService.landing();
		const landing: LandingPayload | null = res.ok && res.data ? res.data : null;
		return page({ landing, origin });
	},
});

export default define.page<typeof handler>(function LandingRoute({ data }) {
	return <LandingPage landing={data.landing} origin={data.origin} />;
});
