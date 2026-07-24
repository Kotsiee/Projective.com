import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `/api/messaging/members` — the thin route for the conversation-scoped Members roster read. HTTP parse
 * + guard, then delegate to the fat {@link MessagingBackendService.members}.
 *
 * It answers the SAME `MemberRosterPage` contract as `/api/projects/members`, so the shared
 * `MemberRoster` island simply swaps its endpoint on `scope="conversation"` — one component, two data
 * sources.
 */
export const handler = define.handlers({
	GET(ctx) {
		const sp = ctx.url.searchParams;
		const conversationId = sp.get("conversationId") ?? sp.get("projectId");
		if (!conversationId) {
			return Response.json({ ok: false, message: "Missing conversationId." }, { status: 400 });
		}
		return toMessagingResponse(MessagingBackendService.members(conversationId));
	},
});
