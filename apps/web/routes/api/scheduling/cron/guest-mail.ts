import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { GuestBackendService } from "@server/services/scheduling/GuestBackendService.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/scheduling/cron/guest-mail` — the scheduler's entry point for mail to guests with no
 * account: what could not go straight away, and every new time and withdrawal
 * ({@link GuestBackendService.sendDue}). Registered as the job `scheduling-guest-mail` (Decision #391).
 *
 * Authenticated by the same bearer token as the horizon job, compared in constant time; anything else
 * is a 404. The body is ignored. Safe to call as often as the scheduler likes. The job asks for 25,
 * and the limit stops at 25, because each send may take ten seconds and a claim is taken again after
 * five minutes: a sweep that outlasted that would send the same message twice.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ScheduleBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "25") || 25, 1),
			25,
		);
		return toSchedulingResponse(await GuestBackendService.sendDue(limit));
	},
});
