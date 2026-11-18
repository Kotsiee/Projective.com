import { define } from "@web/utils/state.ts";
import { QuoteBackendService } from "@server/services/quotes/QuoteBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `GET /api/services/quotes?with=@handle` — every quote request between the caller and one person, in
 * either role, each with its current offer and the acts the caller may take (Decision #458). Read by
 * the buyer's conversation panel and the seller's client drawer.
 *
 * Thin: guard the handle, resolve WHO IS ASKING from the session state, delegate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const handle = ctx.url.searchParams.get("with")?.trim() ?? "";
		if (!/^@?[A-Za-z0-9_.-]{1,64}$/.test(handle)) {
			return Response.json({ ok: false, message: "Missing or malformed handle." }, { status: 400 });
		}
		return toBookingResponse(await QuoteBackendService.listWith(handle, bookingActorFrom(ctx)));
	},
});
