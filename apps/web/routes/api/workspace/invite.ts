import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteMemberInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite` — thin route: refuse a guest, Zod-validate the invitation (handle OR
 * email, plus the role to offer), then delegate to the fat {@link WorkspaceBackendService.invite}.
 *
 * The schema makes both targets optional because exactly one is required, which a flat object schema
 * cannot express; the database refuses a target-less or doubly-addressed invitation, and the route does
 * not second-guess that — re-deriving the rule here would give one mistake two messages.
 *
 * The role is re-checked server-side against the inviter's own authority (nobody may hand out a
 * permission they do not hold), and a duplicate pending invitation comes back `409`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = InviteMemberInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.invite(parsed.data, actor));
	},
});
