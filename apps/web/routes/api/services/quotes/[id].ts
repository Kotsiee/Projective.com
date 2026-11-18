import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { QuoteActInputSchema } from "@projective/types/services";
import { QuoteBackendService } from "@server/services/quotes/QuoteBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";

const RequestId = z.string().uuid();

/**
 * `POST /api/services/quotes/[id]` — one act on one quote request (Decision #458): the host sends,
 * revises or withdraws an offer, or declines the request; the buyer accepts or declines the offer, or
 * withdraws the request. Answers the request as it now stands.
 *
 * Thin: the age gate, the id and the body's discriminated union, then the service, whose door re-checks
 * who may make the move. An accept charges nothing — it puts the offer's one line in the basket.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const id = RequestId.safeParse(ctx.params.id);
		if (!id.success) {
			return Response.json({ ok: false, message: "Unknown quote request." }, { status: 404 });
		}
		const raw = await ctx.req.json().catch(() => null);
		const parsed = QuoteActInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);

		return toBookingResponse(
			await QuoteBackendService.act(id.data, parsed.data, bookingActorFrom(ctx)),
		);
	},
});
