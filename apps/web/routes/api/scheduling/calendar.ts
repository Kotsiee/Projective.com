import { define } from "@web/utils/state.ts";
import { CalendarParamsSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/calendar?projectId=&channelId=&around=` — the project (or channel) calendar
 * page. Thin: guard that somebody is signed in and that `projectId` is present, Zod-validate the
 * params (`around` is the `YYYY-MM-DD` the read is centred on; `422` otherwise), resolve WHO IS ASKING
 * from the session ({@link readActor}), then delegate to the fat
 * {@link ScheduleBackendService.projectCalendar} and map the result. `channelId` narrows to one
 * channel's schedule.
 *
 * Unlike its two sibling reads this one is NOT public. Every surface that mounts it lives under
 * `(dashboard)`, so an engagement's schedule — its stage syncs, its deadlines and, through the
 * coordination projection, who attends them — has no signed-out audience to serve. The guard is here
 * rather than in a route group because `/api/scheduling/*` also carries the genuinely public
 * availability and entity-schedule reads. `ctx.state.isAuthenticated` is a skeleton presence check
 * (root CLAUDE.md §8 Decision #14); the read itself runs as the caller under RLS, which is the real
 * gate, and the service's per-viewer projection is the second lock behind it.
 */
export const handler = define.handlers({
	async GET(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to view this calendar." }, {
				status: 401,
			});
		}
		const projectId = ctx.url.searchParams.get("projectId");
		if (!projectId) {
			return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
		}
		const parsed = CalendarParamsSchema.safeParse({
			projectId,
			channelId: ctx.url.searchParams.get("channelId") || null,
			around: ctx.url.searchParams.get("around") ?? undefined,
		});
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That calendar address is not valid.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toSchedulingResponse(
			await ScheduleBackendService.projectCalendar(parsed.data, readActor(ctx)),
		);
	},
});
