import { define } from "@web/utils/state.ts";
import { RescheduleInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/scheduling/reschedule` — apply one move to an event's reschedule negotiation (propose a
 * slot, approve a client's slot, open the vote, cast a vote, confirm, withdraw) and return the
 * refreshed event.
 *
 * Thin: Zod-validate ({@link RescheduleInputSchema}), guard that somebody is signed in, delegate to
 * the fat {@link ScheduleBackendService.reschedule}, map the result. The route makes no decision
 * about which action is legal — the 12-hour lockout, the two-slot minimum, the host-approval gate and
 * the vote deadline are all applied in the service, against the SSOT's own pure predicates.
 *
 * A refusal comes back as `errors.reason`, a `RescheduleRefusalReason`, so the surface can explain
 * itself without re-deriving the rules client-side.
 *
 * The signed-in guard is here for the same reason as `./rsvp.ts`: the sibling GET reads are public.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to reschedule." }, { status: 401 });
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = RescheduleInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That change could not be made.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		return toSchedulingResponse(
			ScheduleBackendService.reschedule(parsed.data, viewerFromState(ctx.state)),
		);
	},
});
