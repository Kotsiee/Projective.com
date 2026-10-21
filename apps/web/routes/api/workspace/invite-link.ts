import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { OrgInviteLinkActionInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite-link` — a team's or business's ask-to-join link (Decision #318).
 * `{ kind, workspaceId, action, roleId? }`: `ensure` reads or mints it (at `roleId`, default the
 * Member preset), `reset` replaces its URL, `role` re-points it at `roleId`, `revoke` turns it off.
 * Answers `{ link }` (`null` after `revoke`). The read itself rides the console detail
 * (`WorkspaceDetail.inviteLink`), so there is no `GET`. `invite_members` only — the database decides.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = OrgInviteLinkActionInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.inviteLinkAction(parsed.data, actor));
	},
});
