import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/calendar?projectId=&channelId=` — the project (or channel) calendar page. Thin:
 * guard the required `projectId`, then delegate to the fat {@link ScheduleBackendService.projectCalendar}
 * and map the result. `channelId` narrows to one channel's schedule.
 */
export const handler = define.handlers({
	GET(ctx) {
		const projectId = ctx.url.searchParams.get("projectId");
		if (!projectId) {
			return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
		}
		const channelId = ctx.url.searchParams.get("channelId") || null;
		return toSchedulingResponse(ScheduleBackendService.projectCalendar({ projectId, channelId }));
	},
});
