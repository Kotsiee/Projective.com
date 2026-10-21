import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RedeemOrgInviteLinkSchema } from "@projective/types/workspace";
import { guestRefusal, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite-links/redeem` — the holder of a team's or business's invite link asks
 * to join (Decision #318). `{ token, message }` → {@link WorkspaceBackendService.redeemInviteLink}: a
 * pending join request the entity's `invite_members` holders answer. `201` with the request; never a
 * seat. A refused state keeps its status (`409` member · invited · requested, `422` revoked ·
 * archived · persona) with `details.reason` the state.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = RedeemOrgInviteLinkSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "This invite link doesn't work.", errors: { token: "invalid" } },
				{ status: 422 },
			);
		}
		return toWorkspaceResponse(await WorkspaceBackendService.redeemInviteLink(parsed.data, actor));
	},
});
