import { define } from "@web/utils/state.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { FxService } from "@server/services/finance/FxService.ts";

/**
 * `POST /api/finance/cron/fx` — the scheduler's entry point for the daily FX feed (Decision #337,
 * ruling M5 (f); Decision #471; FBP DB17): fetches the provider's rates for the 12 display currencies
 * against GBP and records them all, or none, through {@link FxService.refreshRates}. Registered as the
 * job `finance-fx-daily`.
 *
 * Authenticated by a bearer token (`FINANCE_CRON_SECRET`, ≥ 32 characters), compared in constant time.
 * Anything else — a missing or wrong token, or no secret configured — is a 404, not a 401, like every
 * finance cron. The body is ignored. Safe to call as often as the scheduler likes: a run that finds
 * nothing new records nothing.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!FxService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		return toPaymentsResponse(await FxService.refreshRates());
	},
});
