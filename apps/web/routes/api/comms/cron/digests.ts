import { define } from "@web/utils/state.ts";
import { answerDigestSweep } from "@features/notifications/core/dispatch-ssr.ts";

/**
 * `POST /api/comms/cron/digests?limit=50` — the scheduler's entry point for the `comms-digest-send`
 * http job (every ten minutes from :03; PROJECTS NO2): it mails each built daily and weekly digest
 * once, as counts, titles and links (`DigestMailService.send`). Authenticated by
 * `COMMS_DISPATCH_SECRET` in constant time; anything else is a 404, as the other cron routes. The body
 * is ignored.
 */
export const handler = define.handlers({
	POST(ctx) {
		return answerDigestSweep(ctx.req, ctx.url);
	},
});
