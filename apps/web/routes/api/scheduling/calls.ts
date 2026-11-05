import { define } from "@web/utils/state.ts";
import { CallActionInputSchema } from "@projective/types/scheduling";
import { toFieldErrors, toSchedulingResponse } from "@features/calendar/core/respond.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";

/**
 * `POST /api/scheduling/calls` — one move on a discovery call: confirm, decline, propose a new time,
 * cancel, or report a no-show (Decision #343, ruling C3).
 *
 * Thin: guard the session and the age gate, Zod-validate, delegate to the fat
 * {@link BookingBackendService.callAction}. The route decides nothing about which move is legal: each
 * door in `scheduling` names who may make it and from which state, and a refusal comes back as
 * `errors.reason` with its sentence.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ctx.state.isAuthenticated) {
			return Response.json({ ok: false, message: "Sign in to answer this call." }, { status: 401 });
		}
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;

		const parsed = CallActionInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That change could not be made.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		return toSchedulingResponse(
			await BookingBackendService.callAction(parsed.data, bookingActorFrom(ctx)),
		);
	},
});
