import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SetTicketManagerInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `PATCH /api/projects/:id/members/:memberId/tickets` — thin route: Zod-validate `{ allowed }` and
 * delegate to the fat {@link ProjectBackendService.updateTicketManager}. `:id` is the project slug;
 * `:memberId` is the roster row id (`ProjectMemberRow.id`), never a user id.
 *
 * `projects.set_ticket_manager` is the gate (review authority plus `hire`, a business client's
 * engagement, an admin/manager seat — Decision #294); anyone else gets a typed refusal.
 */
export const handler = define.handlers({
	async PATCH(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to change who manages tickets." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = SetTicketManagerInputSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(
			await ProjectBackendService.updateTicketManager(
				ctx.params.id,
				ctx.params.memberId,
				parsed.data.allowed,
				actor,
			),
		);
	},
});
