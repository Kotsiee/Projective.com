import { define } from "@web/utils/state.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { serviceBody } from "@web/utils/service-response.ts";
import { PublicMetricsService } from "@server/services/marketing/PublicMetricsService.ts";

/**
 * `GET /api/public/metrics` — the public site's live platform figures (Decision #277): the
 * {@link PublicMetricsService} answer in the flat `{ ok, …PublicMetrics }` envelope
 * (`@projective/types/marketing` `PublicMetricsSchema`; a `null` figure is below the threshold and
 * its tile is hidden). Thin: no parameters, no session — the answer is the same for every caller.
 *
 * `HEAD` and `OPTIONS` come from the same resolver. A success is `public-metadata` (shared caches may
 * hold it briefly; the service itself recomputes hourly), with a strong `ETag`; a failure is
 * `no-store`.
 */
export const handler = define.handlers(defineReadRoute({
	resolve: () => PublicMetricsService.get(),
	toBody: serviceBody,
	policy: "public-metadata",
}));
