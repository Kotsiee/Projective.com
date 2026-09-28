import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RespondInviteInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite-respond` — thin route: refuse a guest, validate `{ inviteId, accept }`, then
 * delegate to the fat {@link WorkspaceBackendService.respondInvite} to accept or decline an invitation
 * addressed to the VIEWER.
 *
 * The invitation is matched to the caller in the database (by identity, handle, or a verified email),
 * so the route does not check "is this mine". An already-answered invitation comes back refused, so a
 * double-click cannot re-accept. Resolves `{ status, kind, id, handle }` — the roster re-reads itself.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = RespondInviteInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid invitation response.");
		return toWorkspaceResponse(await WorkspaceBackendService.respondInvite(parsed.data, actor));
	},
});
