import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateMemberInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/member` — thin route: refuse a guest, Zod-validate the membership patch (role ·
 * granted and revoked capabilities · title · reporting line · a business spend envelope · removal), then
 * delegate to the fat {@link WorkspaceBackendService.updateMember}.
 *
 * Every guard is the database's: nobody grants a capability they do not hold, manages somebody who
 * outranks them, or changes the owner's standing except by transfer. Removal is `remove: true`, which
 * moves the member to `left`; nothing is hard-deleted (root CLAUDE.md §5). The data is the re-read
 * detail, or `null` when the caller removed themselves and so has no console left to see.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpdateMemberInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.updateMember(parsed.data, actor));
	},
});
