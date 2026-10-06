import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { guestRefusal, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { ContextBackendService } from "@server/services/context/ContextBackendService.ts";

/**
 * `GET /api/context/organisations` — thin route: the organisations the caller may act as (owned, or an
 * active membership; never archived), for the account popover's context switcher. Refuses a guest,
 * then delegates to the fat {@link ContextBackendService.organisations}, which reads as the caller under
 * RLS. Lives beside `/api/context/switch` because an organisation is an acting context, not a workspace.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(
			await ContextBackendService.organisations({ context, accessToken: actor.accessToken }),
		);
	},
});
