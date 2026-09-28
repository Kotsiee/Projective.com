import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { TransferOwnershipInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/transfer-ownership` — thin route: refuse a guest, Zod-validate
 * `{ kind, workspaceId, successorMemberId, leave }`, then delegate to the fat
 * {@link WorkspaceBackendService.transferOwnership}.
 *
 * ONE act, never two role edits: the entity's owner and the successor's seat move in a single
 * transaction, so there is no window in which the entity has two owners or none. Only the current owner
 * may call it. The data is the re-read detail, or `null` when the outgoing owner left in the same act.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = TransferOwnershipInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.transferOwnership(parsed.data, actor));
	},
});
