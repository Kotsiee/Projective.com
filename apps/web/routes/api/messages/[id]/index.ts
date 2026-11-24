import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { invalidFields, serviceResponse } from "@web/utils/service-response.ts";
import {
	DeleteMessageSchema,
	EditMessageSchema,
	messageChatRef,
} from "@projective/types/messaging";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `PATCH /api/messages/[id]` — the author edits a sent message's words and formatting;
 * `DELETE /api/messages/[id]` — the author deletes it for everyone (PROJECTS CH1; CAS M11). Both thin:
 * Zod on the body, then {@link MessagingBackendService.editMessage} / `deleteMessage`, whose doors
 * (`comms.edit_message`, `comms.delete_message`) decide the author, the edit window and the freeze.
 *
 * The body names the chat the message is in exactly as its send does — an inbox `conversationId`, or
 * a project chat's `projectId` + `channelId` (`messageChatRef`) — so the right caches are dropped and
 * the fixture backend can find the message; the live doors find it by its id alone. Both answer
 * `{ change }`, what the message now reads.
 */
export const handler = define.handlers({
	async PATCH(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = EditMessageSchema.safeParse(raw);
		if (!parsed.success) return invalidFields(parsed.error.issues);
		const { text, delta } = parsed.data;
		return serviceResponse(
			await MessagingBackendService.editMessage(
				ctx.params.id,
				messageChatRef(parsed.data),
				{ text, delta },
				readActor(ctx),
			),
		);
	},

	async DELETE(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = DeleteMessageSchema.safeParse(raw);
		if (!parsed.success) return invalidFields(parsed.error.issues);
		return serviceResponse(
			await MessagingBackendService.deleteMessage(
				ctx.params.id,
				messageChatRef(parsed.data),
				readActor(ctx),
			),
		);
	},
});
