import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { warmCatalog } from "@server/services/explore/live-catalog.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/schedule?entityId=` — a session-based entity's schedule. Thin: guard the required
 * `entityId`, resolve WHO IS ASKING from the session, then delegate to the fat
 * {@link ScheduleBackendService.entitySchedule} and map the result.
 *
 * A public marketing surface, so the viewer travels with the read: a stranger gets the session's seat
 * COUNT (§Part 1.4) and never the people in those seats.
 */
export const handler = define.handlers({
	async GET(ctx) {
		// The listing is resolved from the loaded discovery catalogue.
		await warmCatalog();
		const entityId = ctx.url.searchParams.get("entityId");
		if (!entityId) {
			return Response.json({ ok: false, message: "Missing entityId." }, { status: 400 });
		}
		return toSchedulingResponse(
			await ScheduleBackendService.entitySchedule({ entityId }, viewerFromState(ctx.state)),
		);
	},
});
