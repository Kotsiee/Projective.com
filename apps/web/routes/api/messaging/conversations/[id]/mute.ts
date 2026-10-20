import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SetConversationMutedSchema } from "@projective/types/messaging";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/messaging/conversations/[id]/mute` `{ muted: boolean }` — thin route: mute or unmute a
 * conversation for the caller ONLY (Decision #308). Zod-validated, then delegated to the fat
 * {@link MessagingBackendService.setMuted}; the write is `comms.set_dm_muted`, which touches only the
 * caller's own participant row. The 401 is an identity check — a mute belongs to a participant.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to mute conversations." },
				{ status: 401 },
			);
		}
		const parsed = SetConversationMutedSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Say whether to mute.", errors: { muted: "required" } },
				{ status: 422 },
			);
		}
		return toMessagingResponse(
			await MessagingBackendService.setMuted(ctx.params.id, parsed.data.muted, actor),
		);
	},
});
