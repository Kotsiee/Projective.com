import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `GET /api/messaging/messages?conversationId=…&before=…&limit=…` — thin route: guard the required
 * conversation id + parse the optional scroll-up cursor, then delegate to the fat
 * {@link MessagingBackendService} for a bottom-anchored page of the conversation's messages (the stream
 * the ChatFeed virtualizes; unified with project channels by `chatId`). `before` is the load-older
 * cursor; omit it for the latest page.
 */
export const handler = define.handlers({
	GET(ctx) {
		const conversationId = ctx.url.searchParams.get("conversationId");
		if (!conversationId) {
			return Response.json({ ok: false, message: "Missing conversationId." }, { status: 400 });
		}
		const before = ctx.url.searchParams.get("before");
		const limitRaw = ctx.url.searchParams.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
		return toMessagingResponse(
			MessagingBackendService.messages({
				conversationId,
				before: before || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}),
		);
	},
});
