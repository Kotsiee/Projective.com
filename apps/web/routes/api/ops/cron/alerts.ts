import { define } from "@web/utils/state.ts";
import { answerAlertSweep } from "@features/admin/core/alert-sweep-ssr.ts";

/**
 * `POST /api/ops/cron/alerts?limit=50` — the scheduler's entry point for the alert sweep, the
 * `ops-deliver-alerts` http job (every 5 minutes; MR4, Decision #461): new money and scheduler errors
 * become alerts, a silent nightly check raises the dead-man alert, and what is due goes out by webhook
 * and email (`OpsAlertService.deliver`). Authenticated by `OPS_CRON_SECRET` (≥ 32 characters) in
 * constant time; anything else is a 404, as the other cron routes. The body is ignored.
 */
export const handler = define.handlers({
	POST(ctx) {
		return answerAlertSweep(ctx.req, ctx.url);
	},
});
