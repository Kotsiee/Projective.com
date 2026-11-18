import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveConversationRoute } from "@web/features/messaging/core/conversations-ssr.ts";
import { movedConversationHref } from "@web/features/messaging/core/conversation-model.ts";

/**
 * Conversation routes — what `/messages/:conversationId[/tab]` answers before any page renders
 * (Decision #339 ruling N1; CAS M25 / D9), through the request's one conversation read, which the
 * page and its header, footer and panel slots then share (RED D-06):
 *
 *   - a `cht-…` ref the viewer is in renders the conversation;
 *   - a `dm-<handle>` whose pair already has a thread answers **303** to the thread's
 *     `/messages/cht-…` address, the tab and query kept; with no thread yet it renders the VIRTUAL
 *     conversation, whose first message creates the thread (the composer then moves the page to the
 *     `cht-` address in place);
 *   - anything else — a uuid (uuids do not route, Decision #88), a thread the viewer is not in, an
 *     unknown handle — renders the calm not-found body with a real **404** status.
 *
 * A 401 or 503 from the read keeps its own page and status. The fixture backend keeps its own ids
 * and never redirects.
 */
export default define.middleware(async (ctx) => {
	if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return await ctx.next();
	const id = ctx.params.conversationId ??
		ctx.url.pathname.split("/").filter(Boolean)[1] ?? "";
	const route = await resolveConversationRoute(ctx.url, id, readActor(ctx));
	if (route.ok && route.data?.location) {
		return new Response(null, {
			status: 303,
			headers: { location: movedConversationHref(ctx.url, route.data.location) },
		});
	}
	const res = await ctx.next();
	if (route.status !== 404) return res;
	return new Response(res.body, { status: 404, headers: res.headers });
});
