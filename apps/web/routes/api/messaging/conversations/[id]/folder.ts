import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SetConversationFolderSchema } from "@projective/types/messaging";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/messaging/conversations/[id]/folder` `{ folder: "primary" | "requests" | "archived" }` —
 * thin route: move a conversation between the caller's OWN folders. Zod-validated, then delegated to
 * the fat {@link MessagingBackendService.setFolder}; on the live path the write is
 * `comms.set_dm_inbox_folder`, which touches only the caller's own participant row. The 401 is an
 * identity check — a folder belongs to a participant, and a guest is not one.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to organise your conversations." },
				{ status: 401 },
			);
		}
		const parsed = SetConversationFolderSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Choose Primary, Requests or Archived.",
					errors: { folder: "not_a_folder" },
				},
				{ status: 422 },
			);
		}
		return toMessagingResponse(
			await MessagingBackendService.setFolder(ctx.params.id, parsed.data.folder, actor),
		);
	},
});
