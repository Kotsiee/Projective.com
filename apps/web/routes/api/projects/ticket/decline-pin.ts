import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DeclineTicketPinSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/ticket/decline-pin` — the freelancer a ticket is pinned to turns it down
 * (Decision #547). Zod-validated against {@link DeclineTicketPinSchema}, then
 * {@link ProjectBackendService.declineTicketPin}, which calls `projects.decline_ticket_pin` in the
 * caller's JWT: only the pinned person may decline, and nothing was held, so nothing moves.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to decline a ticket." }, { status: 401 });
		}
		const parsed = DeclineTicketPinSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json({ ok: false, message: "Check the highlighted fields.", errors }, {
				status: 422,
			});
		}
		return toProjectsResponse(await ProjectBackendService.declineTicketPin(parsed.data, actor));
	},
});
