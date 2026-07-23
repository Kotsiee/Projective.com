import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `GET /api/messaging/conversation?id=…` — thin route: guard the required conversation id, then delegate
 * to the fat {@link MessagingBackendService} for the single-conversation metadata (the conversation view
 * header + Members tab). A 404 maps to a missing/inaccessible conversation.
 */
export const handler = define.handlers({
	GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) {
			return Response.json({ ok: false, message: "Missing conversation id." }, { status: 400 });
		}
		return toMessagingResponse(MessagingBackendService.conversation(id));
	},
});
