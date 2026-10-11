import { define } from "@web/utils/state.ts";
import { ReserveSeatInputSchema } from "@projective/types/projects";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";
import { warmCatalog } from "@server/services/explore/live-catalog.ts";

/**
 * `POST /api/services/reserve-seat` — hold seats on a group-session listing's current cohort and put
 * the held seat line in the buyer's basket (Decision #171). The lane's Reserve seat control calls it,
 * then opens Buy Now on that line.
 *
 * Thin: parse, resolve the actor from the session, delegate. The cohort is resolved server-side from
 * the listing (a caller never names one), and `projects.reserve_seat` is the capacity gate — it locks
 * the cohort row, so the last seat cannot be held twice. A signed-out actor is refused by the service.
 */
export const handler = define.handlers({
	async POST(ctx) {
		await warmCatalog();
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ReserveSeatInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toBookingResponse(await BookingBackendService.reserveSeat(parsed.data, bookingActorFrom(ctx)));
	},
});
