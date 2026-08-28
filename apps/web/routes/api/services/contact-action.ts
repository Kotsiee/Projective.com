import { define } from "@web/utils/state.ts";
import { ContactActionInputSchema, serviceSimFromParams } from "@projective/types/services";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `POST /api/services/contact-action` — one route for all three Contact Me actions: book a discovery
 * call, ask a question, request a custom quote.
 *
 * One route because the payload is a discriminated union on `kind`, so a single parse validates all
 * three and a single handler dispatches them. Three routes would mean three places for the actor
 * resolution to drift and three chances to forget the sign-in refusal.
 *
 * **None of the three creates a project, a stage, a ticket or an escrow.** That is `PRODUCT_SPEC.md`
 * §Discovery & Courtesy Calls stated for a call and applied to the whole menu: a buyer asking whether
 * something can be done in French has not commissioned anything, and a surface that turned that
 * question into a project record would punish people for asking.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ContactActionInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);

		return toBookingResponse(
			BookingBackendService.contact(
				parsed.data,
				bookingActorFrom(ctx.state),
				serviceSimFromParams(ctx.url.searchParams),
			),
		);
	},
});
