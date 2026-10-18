import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { PublicMetricsService } from "@server/services/marketing/PublicMetricsService.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { applyPageMeta, pageMeta } from "@features/marketing/core/seo.ts";
import { PLATFORM_FEE_BP } from "@projective/types/finance";
import DeliveryTour from "../islands/DeliveryTour.island.tsx";
import { AboutView } from "../components/AboutView.tsx";
import { ABOUT_META, ABOUT_PATH } from "../core/about-content.ts";
import { aboutJsonLd } from "../core/about-seo.ts";
import { formatFeePercent } from "../core/metric-format.ts";

/**
 * `/about` — the editorial manifesto page (PUBLIC_ROUTES P4, Decision #277). Thin controller: read
 * the live figures from {@link PublicMetricsService} (server-side, cached for an hour — the page
 * never fetches them from the browser), set the page meta, and render {@link AboutView} with the
 * `DeliveryTour` island, the page's only island. A failed read still renders the page; its metrics
 * section says the figures are unavailable and shows none.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const result = await PublicMetricsService.get();
		const origin = siteOrigin(ctx.url);
		applyPageMeta(
			ctx.state,
			pageMeta({
				title: ABOUT_META.title,
				description: ABOUT_META.description,
				path: ABOUT_PATH,
				origin,
			}),
		);
		return page({ metrics: result.ok && result.data ? result.data : null, origin });
	},
});

export default define.page<typeof handler>(function AboutPage({ data, state }) {
	const feePercent = formatFeePercent(data.metrics?.platformFeeBp ?? PLATFORM_FEE_BP);
	return (
		<>
			<AboutView
				metrics={data.metrics}
				isAuthenticated={!!state.isAuthenticated}
				tour={<DeliveryTour feePercent={feePercent} />}
			/>
			<JsonLd graph={aboutJsonLd(data.origin)} />
		</>
	);
});
