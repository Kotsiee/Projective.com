import { define } from "@web/utils/state.ts";
import { SessionBookingInputSchema, serviceSimFromParams } from "@projective/types/services";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `POST /api/services/book-session` — reserve the chosen slot(s) and stage the booking for checkout.
 *
 * Thin: parse, resolve the actor from the session, delegate. Every rule lives in the fat service —
 * which slot ids are still takeable, whether a cohort has the seats asked for, how many slots a
 * set-session block may schedule up front — and each is enforced by re-resolving the slot through
 * the very reader that drew the grid, never by trusting the instants a caller sends.
 *
 * The route does not check for a session either. {@link BookingBackendService.bookSession} refuses an
 * unauthenticated actor on its own account, so the guard cannot be bypassed by reaching the service
 * from a different route — and there is exactly one place that rule lives.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SessionBookingInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);

		return toBookingResponse(
			BookingBackendService.bookSession(
				parsed.data,
				bookingActorFrom(ctx.state),
				serviceSimFromParams(ctx.url.searchParams),
			),
		);
	},
});
