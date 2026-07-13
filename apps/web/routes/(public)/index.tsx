import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { LandingPage } from "@features/marketing/components/LandingPage.tsx";
import { LANDING_META } from "@features/marketing/core/seo.ts";

/**
 * Public landing route (thin controller). Sets the SEO title/description onto request state — the
 * root `_app` renders them into `<head>` — and delegates the whole marketing surface to the
 * `@features/marketing` composition. The page stays presentational; the hero field and the two
 * showcase tracks are the only islands.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = LANDING_META.title;
		ctx.state.description = LANDING_META.description;
		return page();
	},
});

export default define.page(function LandingRoute() {
	return <LandingPage />;
});
