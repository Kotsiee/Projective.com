import { define } from "@web/utils/state.ts";
import { QuoteBackendService } from "@server/services/quotes/QuoteBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `GET /api/services/quotes/listings` — the services the caller may quote from a conversation
 * (Decision #522): their own published listings, never a group session. Read by the quote composer.
 *
 * Thin: resolve WHO IS ASKING, delegate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return toBookingResponse(await QuoteBackendService.quotableListings(bookingActorFrom(ctx)));
	},
});
