import { define } from "@web/utils/state.ts";
import { answerDispatchSweep } from "@features/notifications/core/dispatch-ssr.ts";

/**
 * `POST /api/comms/cron/dispatch?limit=200` — the scheduler's entry point for the dispatcher's retry
 * sweep, the `comms-dispatch-sweep` http job (every minute, Decision #344 (a)): it sends what the
 * trigger's post missed and retries each failure past its backoff (`NotificationDispatchService.dispatch`).
 * Authenticated by `COMMS_DISPATCH_SECRET` (≥ 32 characters) in constant time; anything else is a 404,
 * as the other cron routes. The body is ignored.
 */
export const handler = define.handlers({
	POST(ctx) {
		return answerDispatchSweep(ctx.req, ctx.url);
	},
});
