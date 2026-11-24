import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { AssignTicketSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/ticket/assign` — pin one ticket on a manual stage to a live-seat holder
 * (Decision #547). Zod-validated against {@link AssignTicketSchema}, then
 * {@link ProjectBackendService.assignTicket}, which calls `projects.assign_ticket_manual` in the
 * caller's JWT: review authority, `hire`, the manual stage, the live seat and the caps are the door's.
 * The pin holds nothing; the freelancer accepts it through the claim route.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to assign a ticket." }, { status: 401 });
		}
		const parsed = AssignTicketSchema.safeParse(await ctx.req.json().catch(() => null));
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
		return toProjectsResponse(await ProjectBackendService.assignTicket(parsed.data, actor));
	},
});
