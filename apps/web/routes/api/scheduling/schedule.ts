import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/schedule?entityId=` — a session-based entity's schedule. Thin: guard the required
 * `entityId`, then delegate to the fat {@link ScheduleBackendService.entitySchedule} and map the result.
 */
export const handler = define.handlers({
	GET(ctx) {
		const entityId = ctx.url.searchParams.get("entityId");
		if (!entityId) {
			return Response.json({ ok: false, message: "Missing entityId." }, { status: 400 });
		}
		return toSchedulingResponse(ScheduleBackendService.entitySchedule({ entityId }));
	},
});
