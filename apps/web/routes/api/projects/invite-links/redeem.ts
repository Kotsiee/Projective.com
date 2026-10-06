import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RedeemInviteLinkSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { InviteLinkService } from "@server/services/projects/InviteLinkService.ts";

/**
 * `POST /api/projects/invite-links/redeem` — the holder of a stage invite link asks to join
 * (Decision #145). Zod-validated against {@link RedeemInviteLinkSchema}, then the fat
 * {@link InviteLinkService.redeem}: a pending request on the link's stage that the project's managers
 * answer from the Members tab. 201 with the request; never a seat.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to ask to join a stage." }, {
				status: 401,
			});
		}
		const parsed = RedeemInviteLinkSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "This invite link doesn't work.", errors: { token: "invalid" } },
				{ status: 422 },
			);
		}
		const handle = ctx.state.userContext?.handle ?? null;
		const requester = {
			name: handle ? `@${handle.replace(/^@+/, "")}` : "A freelancer",
			avatar: null,
			handle,
		};
		return toProjectsResponse(await InviteLinkService.redeem(parsed.data, actor, requester));
	},
});
