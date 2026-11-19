import { define } from "@web/utils/state.ts";
import { answerHealth } from "@features/admin/core/health-ssr.ts";

/**
 * `GET /api/ops/health` — the heartbeat an outside monitor polls every 5 minutes (OPS5): 200 `{ok:
 * true}` only when the database answers, `ops-watch-jobs` succeeded within `heartbeat_watch_minutes`
 * and no alert has waited undelivered for 15 minutes; 503 `{ok: false}` otherwise
 * (`OpsHealthService.heartbeat`). Authenticated by `OPS_HEALTH_TOKEN` (≥ 32 characters) in constant
 * time; anything else is a 404. Never cached.
 */
export const handler = define.handlers({
	GET(ctx) {
		return answerHealth(ctx.req);
	},
});
