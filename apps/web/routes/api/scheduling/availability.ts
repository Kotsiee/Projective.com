import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { schedulingSimFromParams } from "@projective/types/scheduling";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/availability?handle=` — a `@handle`'s availability schedule. Thin: guard the
 * required `handle`, resolve WHO IS ASKING from the session (never from the query string), then
 * delegate to the fat {@link ScheduleBackendService.availability} (which rejects reserved handles)
 * and map the result.
 *
 * Deliberately reachable signed-out — a freelancer's availability is a public page — which is
 * precisely why the viewer travels with the read: the service withholds the roster, the meeting link
 * and the host's earnings from anyone who is not a party to an event.
 */
export const handler = define.handlers({
	GET(ctx) {
		const handle = ctx.url.searchParams.get("handle");
		if (!handle) {
			return Response.json({ ok: false, message: "Missing handle." }, { status: 400 });
		}
		return toSchedulingResponse(
			ScheduleBackendService.availability(
				{ handle },
				viewerFromState(ctx.state),
				schedulingSimFromParams(ctx.url.searchParams),
			),
		);
	},
});
