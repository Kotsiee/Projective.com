import { define } from "@web/utils/state.ts";
import { serviceSimFromParams } from "@projective/types/services";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `GET /api/services/offer?subjectId=&handle=` — the resolved commercial offer for one listing and
 * one viewer: what the primary control says, what it does, what the Contact menu may show, and
 * whether this buyer already has a draft.
 *
 * Thin: guard the required id, resolve WHO IS ASKING from the session state (never from the query),
 * parse the developer simulation overlay, then delegate.
 *
 * **Public and guest-reachable.** The listing page is SEO-facing, so an unauthenticated caller gets a
 * real offer with `requiresSignIn` set — not a 401. Refusing here would leave a guest looking at a
 * page whose only purpose is its call to action with no call to action on it; the writes are what
 * require an account, and each of them refuses on its own behalf.
 */
export const handler = define.handlers({
	GET(ctx) {
		const subjectId = ctx.url.searchParams.get("subjectId");
		if (!subjectId) {
			return Response.json({ ok: false, message: "Missing subjectId." }, { status: 400 });
		}
		return toBookingResponse(
			BookingBackendService.offer(subjectId, bookingActorFrom(ctx.state), {
				handle: ctx.url.searchParams.get("handle"),
				sim: serviceSimFromParams(ctx.url.searchParams),
			}),
		);
	},
});
