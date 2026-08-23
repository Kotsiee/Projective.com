import { define } from "@web/utils/state.ts";
import { toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { schedulingSimFromParams } from "@projective/types/scheduling";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/calendar?projectId=&channelId=` — the project (or channel) calendar page. Thin:
 * guard that somebody is signed in and that `projectId` is present, resolve WHO IS ASKING from the
 * session, then delegate to the fat {@link ScheduleBackendService.projectCalendar} and map the result.
 * `channelId` narrows to one channel's schedule.
 *
 * Unlike its two sibling reads this one is NOT public. Every surface that mounts it lives under
 * `(dashboard)`, so an engagement's schedule — its stage syncs, its deadlines and, through the
 * coordination projection, who attends them — has no signed-out audience to serve. The guard is here
 * rather than in a route group because `/api/scheduling/*` also carries the genuinely public
 * availability and entity-schedule reads. `ctx.state.isAuthenticated` is a skeleton presence check
 * (root CLAUDE.md §8 Decision #14); RLS remains the real gate once the live path lands, and the
 * service's per-viewer projection is the second lock behind this one.
 *
 * The `sim*` params are the developer simulation overlay (root CLAUDE.md §5). They are validated
 * against the SSOT's own schema, so a hand-crafted URL cannot inject an unvalidated shape, and they
 * grant nothing — they only move which coordination inputs the fixture projection derives from.
 */
export const handler = define.handlers({
	GET(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to view this calendar." }, {
				status: 401,
			});
		}
		const projectId = ctx.url.searchParams.get("projectId");
		if (!projectId) {
			return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
		}
		const channelId = ctx.url.searchParams.get("channelId") || null;
		return toSchedulingResponse(
			ScheduleBackendService.projectCalendar(
				{ projectId, channelId },
				viewerFromState(ctx.state),
				schedulingSimFromParams(ctx.url.searchParams),
			),
		);
	},
});
