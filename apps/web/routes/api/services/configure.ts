import { define } from "@web/utils/state.ts";
import { ServiceBriefInputSchema } from "@projective/types/services";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `POST /api/services/configure` — stage a scoped engagement (a One-Off or a Single Task) for
 * checkout.
 *
 * Thin: parse, resolve the actor, delegate. The fat service decides which stages the chosen funding
 * scope resolves to, validates any explicit stage selection against the listing's OWN stage ids —
 * a caller can otherwise name a stage from a different service and have it funded here — and attaches
 * the brief to the basket line.
 *
 * The brief is required by the schema rather than by this route, and deliberately so: it is the
 * specification the engagement will be delivered against, and a stage funded against a scope nobody
 * wrote down is a dispute waiting for a trigger.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = ServiceBriefInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);

		return toBookingResponse(
			BookingBackendService.configure(parsed.data, bookingActorFrom(ctx.state)),
		);
	},
});
