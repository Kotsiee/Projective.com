import { define } from "@web/utils/state.ts";
import { ClashQuerySchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `GET /api/scheduling/clashes?start=&end=&excludeEventId=` — what already holds the reader's own time
 * across a span: the event modal's check as its times change. Takes no person: whose calendar is
 * answered by the session, never by the caller.
 *
 * Thin: guard that somebody is signed in, Zod-validate, delegate to the fat
 * {@link ScheduleBackendService}, map the result.
 */
export const handler = define.handlers({
	async GET(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to check your calendar." }, {
				status: 401,
			});
		}
		const q = new URL(ctx.req.url).searchParams;
		const parsed = ClashQuerySchema.safeParse({
			start: Number(q.get("start")),
			end: Number(q.get("end")),
			excludeEventId: q.get("excludeEventId") ?? undefined,
		});
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those times could not be checked.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toSchedulingResponse(await ScheduleBackendService.clashes(parsed.data, readActor(ctx)));
	},
});
