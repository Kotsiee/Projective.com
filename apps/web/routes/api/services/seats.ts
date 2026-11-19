import { define } from "@web/utils/state.ts";
import { SeatLinkActionSchema } from "@projective/types/projects";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";

/**
 * `POST /api/services/seats` — a multi-seat booking's seat link (Decision #522): `share` opens (or
 * returns) the buyer's link for their spare seats, `revoke` closes it, and `claim` takes one seat
 * through a link, first come first served. Thin: the age gate, the discriminated body, the service,
 * whose doors re-check who may act.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SeatLinkActionSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		const actor = readActor(ctx);
		const input = parsed.data;
		return toBookingResponse(
			input.action === "claim"
				? await SessionBackendService.claimSeat(input.code, actor)
				: await SessionBackendService.seatLink(input.action, input.membershipId, actor),
		);
	},
});
