import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RespondToInvitationSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/invites/respond` `{ invitationIds, accept }` — the invitee answers a request
 * (every stage of a multi-stage hire together). Zod-validated, then the fat
 * {@link ProjectBackendService.respondToInvitations}; on the live path each answer is
 * `projects.respond_to_project_invitation`, which refuses anybody but the person invited.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to answer an invitation." }, {
				status: 401,
			});
		}
		const parsed = RespondToInvitationSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Name the invitation to answer.",
					errors: { invitationIds: "required" },
				},
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.respondToInvitations(parsed.data, actor));
	},
});
