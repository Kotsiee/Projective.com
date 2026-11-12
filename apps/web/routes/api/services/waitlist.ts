import { define } from "@web/utils/state.ts";
import { JoinWaitlistInputSchema } from "@projective/types/projects";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";
import { warmCatalog } from "@server/services/explore/live-catalog.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";

/**
 * `POST /api/services/waitlist` — queue the caller on a group-session listing's waitlist
 * (`projects.waitlists`, Decision #424). The lane's Join the waitlist / Notify me control calls it.
 * Thin: parse, resolve the actor, delegate; a repeat answers with the existing place.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		await warmCatalog();
		const raw = await ctx.req.json().catch(() => null);
		const parsed = JoinWaitlistInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toBookingResponse(
			await BookingBackendService.joinWaitlist(parsed.data, bookingActorFrom(ctx)),
		);
	},
});
