import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteMemberInputSchema, InviteMembersInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite` — thin route: refuse a guest, Zod-validate, then delegate to the fat
 * service. Two payloads, told apart by `recipients`:
 *
 *   - **the batch** (Decision #318) — {@link InviteMembersInputSchema}: up to ten `{ type, value,
 *     roleId }` recipients and one optional note → {@link WorkspaceBackendService.inviteMany}, which
 *     sends them in order and answers `201` with `{ detail, sent, refused }` (the first refusal's
 *     status only when nothing was sent);
 *   - **one invitation** — {@link InviteMemberInputSchema} (handle OR email, plus the role) →
 *     {@link WorkspaceBackendService.invite}, answering the re-read detail.
 *
 * The role is re-checked server-side against the inviter's own authority (nobody may hand out a
 * permission they do not hold), and a duplicate pending invitation is refused `409`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const raw: unknown = await ctx.req.json().catch(() => null);
		if (raw && typeof raw === "object" && "recipients" in raw) {
			const batch = InviteMembersInputSchema.safeParse(raw);
			if (!batch.success) return invalidPayload(batch.error);
			return toWorkspaceResponse(await WorkspaceBackendService.inviteMany(batch.data, actor));
		}
		const parsed = InviteMemberInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.invite(parsed.data, actor));
	},
});
