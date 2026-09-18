import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SendConversationMessageSchema } from "@projective/types/messaging";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/messaging/messages/send` — thin route: Zod-validate one composer payload and delegate
 * to the fat {@link MessagingBackendService.sendMessage}, which returns the persisted message. The
 * messaging twin of `/api/projects/messages/send`, and the endpoint the shared `ChatComposer` posts
 * to in its `conversation` scope — so the profile's floating messenger, the pop-out chat and
 * `/messages/[conversationId]` all send through one door.
 *
 * **No bytes pass through here.** Attachments arrive as `files.items` ids, already uploaded through
 * the files handshake, so a library-picked attachment and a just-uploaded one are the same thing on
 * this wire.
 *
 * **No capability guard.** Thread membership is enforced by RLS on `comms.dm_messages`, whose INSERT
 * policy also pins `sender_user_id` to the acting identity. The 401 is an identity check: a message
 * with no author is not a message.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to send a message." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = SendConversationMessageSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toMessagingResponse(await MessagingBackendService.sendMessage(parsed.data, actor));
	},
});
