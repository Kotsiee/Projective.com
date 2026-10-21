import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	RespondJoinRequestInputSchema,
	WithdrawJoinRequestInputSchema,
} from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/join-request` — a join request filed through an invite link (Decision #318).
 *
 *   - the inviting side: {@link RespondJoinRequestInputSchema} `{ kind, workspaceId, requestId,
 *     accept, roleId? }` → {@link WorkspaceBackendService.respondJoinRequest}; approving seats them at
 *     `roleId` (default the role they asked for) and answers the re-read detail;
 *   - the requester: `{ requestId, action: "withdraw" }` → `{ id, status: "withdrawn" }`.
 *
 * Told apart by `action`. The database decides authority: anyone without `invite_members` (or, for a
 * withdraw, anyone but the requester) reads `404`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const raw: unknown = await ctx.req.json().catch(() => null);
		if (raw && typeof raw === "object" && "action" in raw) {
			const withdraw = WithdrawJoinRequestInputSchema.safeParse(raw);
			if (!withdraw.success) return invalidPayload(withdraw.error);
			return toWorkspaceResponse(
				await WorkspaceBackendService.withdrawJoinRequest(withdraw.data.requestId, actor),
			);
		}
		const parsed = RespondJoinRequestInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(
			await WorkspaceBackendService.respondJoinRequest(parsed.data, actor),
		);
	},
});
