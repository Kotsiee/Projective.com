import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ConversationIdSchema } from "@projective/types/messaging";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/messaging/conversations/[id]/read` — thin route: mark a conversation read for the caller
 * (CAS M10, PRD-C11). Bodiless, so the `/api` origin guard (`utils/csrf.ts`) passes it only from this
 * site's own pages and refuses a cross-site post with a 403 before this handler runs.
 *
 * The chat island sends it once the thread has painted in a visible tab: a read is the person having
 * seen the latest page, which a GET of the page cannot know (a prefetch, a link unfurler or a
 * cross-site navigation fetches it too). Delegated to the fat {@link MessagingBackendService.markRead}
 * (`comms.mark_dm_read`, which advances only the caller's own `last_read_at`). Idempotent: a second
 * call moves nothing and answers the same 204. A conversation the caller cannot read is a 404; the
 * fixture backend keeps its corpus's own unread flags and answers 204.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to read conversations." },
				{ status: 401, headers: { "cache-control": "no-store" } },
			);
		}
		const id = ConversationIdSchema.safeParse(ctx.params.id);
		if (!id.success) {
			return Response.json(
				{ ok: false, message: "No such conversation." },
				{ status: 404, headers: { "cache-control": "no-store" } },
			);
		}
		const result = await MessagingBackendService.markRead(id.data, actor);
		if (!result.ok) return toMessagingResponse(result);
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	},
});
