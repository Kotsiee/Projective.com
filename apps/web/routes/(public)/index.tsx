import { page } from "fresh";
import type { LandingPayload } from "@projective/types/explore";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import { define } from "@web/utils/state.ts";
import { LandingPage } from "@features/marketing/components/LandingPage.tsx";
import { LANDING_META } from "@features/marketing/core/seo.ts";

/**
 * Public landing route (thin controller). Sets the SEO title/description onto request state — the
 * root `_app` renders them into `<head>` — reads the live marketplace once through the fat
 * discovery service, and delegates the whole marketing surface to the `@features/marketing`
 * composition. A failed read renders the page with the listings withheld (`landing: null`) rather
 * than an error document: the landing's story does not depend on the database being up.
 */
export const handler = define.handlers({
	async GET(ctx) {
		ctx.state.title = LANDING_META.title;
		ctx.state.description = LANDING_META.description;
		const res = await ExploreBackendService.landing();
		const landing: LandingPayload | null = res.ok && res.data ? res.data : null;
		return page({ landing });
	},
});

export default define.page<typeof handler>(function LandingRoute({ data }) {
	return <LandingPage landing={data.landing} />;
});
