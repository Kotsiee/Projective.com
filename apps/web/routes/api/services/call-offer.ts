import { define } from "@web/utils/state.ts";
import { serviceSimFromParams } from "@projective/types/services";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `GET /api/services/call-offer?handle=` — a provider's public call offer, for the seller's
 * PROFILE: whether they take discovery calls, the two flavours' durations and the paid fee, whether
 * an agenda is required, and which conferencing platforms they can mint a room on.
 *
 * Thin: guard the required handle, parse the developer simulation overlay, delegate. The profile's
 * hero SSRs the same read directly through the fat service; this route exists so the hero can
 * RE-READ it when the developer seam flips the `callOffer` axis — the server never saw the client
 * seam, so the first byte is answering a question the developer has already changed.
 *
 * **Guest-reachable and side-effect free.** It discloses exactly what the listing's Contact menu
 * already publishes for the same provider (`PublicCallOffer` — never the caps, cooldowns or
 * buffers). Booking one is what requires an account, and that write refuses on its own behalf.
 */
export const handler = define.handlers({
	GET(ctx) {
		const handle = ctx.url.searchParams.get("handle");
		if (!handle) {
			return Response.json({ ok: false, message: "Missing handle." }, { status: 400 });
		}
		return toBookingResponse(
			BookingBackendService.callOffer(handle, serviceSimFromParams(ctx.url.searchParams)),
		);
	},
});
