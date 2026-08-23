import { define } from "@web/utils/state.ts";
import { RsvpInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/scheduling/rsvp` — record the viewer's own answer to an event and return the refreshed
 * event.
 *
 * Thin: Zod-validate ({@link RsvpInputSchema}), guard that somebody is signed in, delegate to the fat
 * {@link ScheduleBackendService.respond}, map the result. Every rule — who may answer, whether the
 * event has already happened — lives in the service.
 *
 * The signed-in guard is here rather than a route group because `/api/scheduling/*` also serves the
 * PUBLIC availability and entity-schedule reads, which a signed-out visitor must keep. Answering an
 * invitation is an act by an identified person, so the write half needs the check the reads do not.
 * `ctx.state.isAuthenticated` is a skeleton presence check (Decision #14); RLS remains the real gate
 * once the live path lands.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to respond." }, { status: 401 });
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = RsvpInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That response could not be recorded.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		return toSchedulingResponse(
			ScheduleBackendService.respond(parsed.data, viewerFromState(ctx.state)),
		);
	},
});
