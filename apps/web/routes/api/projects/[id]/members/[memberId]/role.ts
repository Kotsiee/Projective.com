import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateMemberRoleInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `PATCH /api/projects/:id/members/:memberId/role` — thin route: Zod-validate the new role and
 * delegate to the fat {@link ProjectBackendService.updateMemberRole}. `:id` is the project slug;
 * `:memberId` is the roster row id (`ProjectMemberRow.id`), never a user id.
 *
 * `projects.set_member_role` is the gate (review authority — the owner or a client-business member);
 * anyone else gets a typed `403`. No capability guard here (Decision #53(b)).
 */
export const handler = define.handlers({
	async PATCH(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to change a member's role." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpdateMemberRoleInputSchema.safeParse(raw);
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
			await ProjectBackendService.updateMemberRole(
				ctx.params.id,
				ctx.params.memberId,
				parsed.data.role,
				actor,
			),
		);
	},
});
