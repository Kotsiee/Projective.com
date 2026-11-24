import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { MarkChatReadInputSchema, projectChatRef } from "@projective/types/messaging";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/projects/messages/read` — thin route: mark the conversation a project chat shows read
 * for the caller (PROJECTS CH3; PRD-E13, PRD-E17). The body names it exactly as the composer's send
 * does (`{ projectId, channelId }`, the same `projectChatRef`), so a `cht-` channel marks the thread
 * the inbox shows and any other channel marks the caller's own mark in that room. Delegated to the
 * fat {@link MessagingBackendService.markChatRead}.
 *
 * The project chat island sends it once the page has painted in a visible tab: a read is the person
 * having seen the latest page, which a GET of the page cannot know (CAS M10; PRD-C11 — a GET writes
 * nothing). The `/api` origin guard (`utils/csrf.ts`) refuses a cross-site post. Idempotent: a second
 * call moves nothing and answers the same 204. A room or thread the caller cannot read is a 404.
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
		const raw = await ctx.req.json().catch(() => null);
		const parsed = MarkChatReadInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "No such conversation." },
				{ status: 404, headers: { "cache-control": "no-store" } },
			);
		}
		const result = await MessagingBackendService.markChatRead(
			projectChatRef(parsed.data.projectId, parsed.data.channelId),
			actor,
		);
		if (!result.ok) return toProjectsResponse(result);
		return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
	},
});
