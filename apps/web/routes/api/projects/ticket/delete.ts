import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DeleteTicketSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/ticket/delete` — the client deletes one pristine ticket (PRODUCT_SPEC §Deletion
 * Protocol). Zod-validated against {@link DeleteTicketSchema}, then the fat
 * {@link ProjectBackendService.deleteTicket}, which refuses a ticket that has been claimed, funded or
 * submitted against and calls `projects.delete_ticket` in the caller's JWT.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to delete a ticket." }, { status: 401 });
		}
		const parsed = DeleteTicketSchema.safeParse(await ctx.req.json().catch(() => null));
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
		return toProjectsResponse(await ProjectBackendService.deleteTicket(parsed.data, actor));
	},
});
