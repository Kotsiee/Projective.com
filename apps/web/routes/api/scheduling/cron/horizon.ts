import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/scheduling/cron/horizon` — the scheduler's entry point for the availability horizon:
 * every live preset not compiled, or compiled through an earlier date than today + 90 days, is
 * recompiled over today → today + 120 days ({@link ScheduleBackendService.extendHorizons}). Registered
 * as the job `scheduling-availability-horizon` (Decision #203).
 *
 * Authenticated by a bearer token (`SCHEDULING_CRON_SECRET`, ≥ 32 characters), compared in constant
 * time; anything else is a 404, as the other cron routes. The body is ignored. Safe to call as often
 * as the scheduler likes: a recompile replaces the window it covers.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ScheduleBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "200") || 200, 1),
			1000,
		);
		return toSchedulingResponse(await ScheduleBackendService.extendHorizons(limit));
	},
});
