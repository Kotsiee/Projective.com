import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteActionInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite-action` — thin route: refuse a guest, Zod-validate `{ kind, workspaceId,
 * inviteId, action: "revoke" | "resend" }`, then delegate to the fat
 * {@link WorkspaceBackendService.inviteAction}.
 *
 * These are the INVITING side's two queue actions, and they live on their own endpoint on purpose: the
 * invitee's accept/decline (`/api/workspace/invite-respond`) authorises against the addressee, these
 * against the entity's `invite_members` holders. One endpoint for both would make every admin action a
 * question the invitee's rules answer — which is how a queue ends up refusing its own admins.
 *
 * Resolves the re-read detail, so the queue drops a revoked row and shows a resent one's new expiry.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = InviteActionInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid invitation action.");
		return toWorkspaceResponse(await WorkspaceBackendService.inviteAction(parsed.data, actor));
	},
});
