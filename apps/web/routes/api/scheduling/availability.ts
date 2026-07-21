import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/availability?handle=` — a `@handle`'s availability schedule. Thin: guard the
 * required `handle`, then delegate to the fat {@link ScheduleBackendService.availability} (which rejects
 * reserved handles) and map the result.
 */
export const handler = define.handlers({
	GET(ctx) {
		const handle = ctx.url.searchParams.get("handle");
		if (!handle) {
			return Response.json({ ok: false, message: "Missing handle." }, { status: 400 });
		}
		return toSchedulingResponse(ScheduleBackendService.availability({ handle }));
	},
});
