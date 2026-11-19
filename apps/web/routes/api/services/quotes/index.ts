import { define } from "@web/utils/state.ts";
import { IssueQuoteInputSchema } from "@projective/types/services";
import { QuoteBackendService } from "@server/services/quotes/QuoteBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";

/**
 * `GET /api/services/quotes?with=@handle` — every quote request between the caller and one person, in
 * either role, each with its current offer, its history and the acts the caller may take (Decisions
 * #458, #522). Read by the buyer's conversation panel and the seller's client drawer.
 *
 * `POST /api/services/quotes` `{ action: "issue", buyer, listing, … }` — a seller's own quote from a
 * conversation the buyer started (Decision #522), answered with the request it now stands on.
 *
 * Thin: guard the input, resolve WHO IS ASKING from the session state, delegate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const handle = ctx.url.searchParams.get("with")?.trim() ?? "";
		if (!/^@?[A-Za-z0-9_.-]{1,64}$/.test(handle)) {
			return Response.json({ ok: false, message: "Missing or malformed handle." }, { status: 400 });
		}
		return toBookingResponse(await QuoteBackendService.listWith(handle, bookingActorFrom(ctx)));
	},

	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const raw = await ctx.req.json().catch(() => null);
		const parsed = IssueQuoteInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toBookingResponse(await QuoteBackendService.issue(parsed.data, bookingActorFrom(ctx)));
	},
});
