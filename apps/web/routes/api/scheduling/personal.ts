import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { schedulingSimFromParams } from "@projective/types/scheduling";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/personal` — the acting account's own agenda for the `/calendar` hub. Thin:
 * resolve WHO IS ASKING from the session, then delegate to the fat
 * {@link ScheduleBackendService.personalCalendar} and map the result.
 *
 * It takes NO scope parameter, deliberately. "Whose calendar" is answered by the session and can
 * never be answered by the caller — a `?handle=` here would be a way to read somebody else's week,
 * and the public view of a person's schedule already has its own route
 * (`/api/scheduling/availability`) with its own privacy projection.
 *
 * Signed-in only, like its `/api/scheduling/calendar` sibling and unlike the two genuinely public
 * reads. Leaning on the per-viewer projection alone is not enough here: that withholds the
 * COORDINATION fields (the room, the roster, the money, the negotiation), while an event's own
 * `title`, `location` and `meta` are in `PUBLIC_EVENT_FIELDS` — so a signed-out caller still came
 * back with the names and places of the engagements on somebody's week. "Whose calendar" is answered
 * by the session, and for a guest the answer is nobody's.
 *
 * `ctx.state.isAuthenticated` is a skeleton presence check (root CLAUDE.md §8 Decision #14); RLS
 * remains the real gate once the live path lands, and the service's per-viewer projection is the
 * second lock behind this one.
 */
export const handler = define.handlers({
	GET(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to view your calendar." }, {
				status: 401,
			});
		}
		return toSchedulingResponse(
			ScheduleBackendService.personalCalendar(
				viewerFromState(ctx.state),
				schedulingSimFromParams(ctx.url.searchParams),
			),
		);
	},
});
