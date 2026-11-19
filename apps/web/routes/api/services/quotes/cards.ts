import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { QuoteBackendService } from "@server/services/quotes/QuoteBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { toBookingResponse } from "@features/view/core/respond.ts";

const EventIds = z.array(z.string().uuid()).min(1).max(100);

/**
 * `GET /api/services/quotes/cards?events=<uuid>,<uuid>` — the quote cards a conversation renders
 * (Decision #522): for each quote event its messages carry, the move, the terms and hash as they stood,
 * and where that offer stands now, with the acts the viewer may take. Ids the caller is not a party to
 * are left out.
 *
 * Thin: parse the ids, resolve WHO IS ASKING, delegate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const ids = EventIds.safeParse(
			(ctx.url.searchParams.get("events") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
		);
		if (!ids.success) {
			return Response.json({ ok: false, message: "Name 1 to 100 quote events." }, { status: 400 });
		}
		return toBookingResponse(await QuoteBackendService.cards(ids.data, bookingActorFrom(ctx)));
	},
});
