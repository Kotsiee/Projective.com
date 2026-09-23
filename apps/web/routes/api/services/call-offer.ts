import { define } from "@web/utils/state.ts";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `GET /api/services/call-offer?handle=` — a provider's public call offer, for the seller's
 * PROFILE: whether they take discovery calls, the two flavours' durations and the paid fee, whether
 * an agenda is required, and which conferencing platforms they can mint a room on.
 *
 * Thin: guard the required handle, delegate. It reads the provider's published call settings live —
 * the same read the listing's Contact menu and the profile's consultation row use.
 *
 * **Guest-reachable and side-effect free.** It discloses exactly what the listing's Contact menu
 * already publishes for the same provider (`PublicCallOffer` — never the caps, cooldowns or
 * buffers). Booking one is what requires an account, and that write refuses on its own behalf.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const handle = ctx.url.searchParams.get("handle");
		if (!handle) {
			return Response.json({ ok: false, message: "Missing handle." }, { status: 400 });
		}
		return toBookingResponse(await BookingBackendService.callOffer(handle));
	},
});
