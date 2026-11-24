import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SetStageAssignmentModeSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/stages/assignment-mode` — route one stage by open pull or by hand (Decision
 * #547). Zod-validated against {@link SetStageAssignmentModeSchema}, which admits only the shipping
 * modes, then {@link ProjectBackendService.setStageAssignmentMode}, which calls
 * `projects.set_stage_assignment_mode` in the caller's JWT: review authority and `hire` are the door's.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to route a stage." }, { status: 401 });
		}
		const parsed = SetStageAssignmentModeSchema.safeParse(await ctx.req.json().catch(() => null));
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
		return toProjectsResponse(
			await ProjectBackendService.setStageAssignmentMode(parsed.data, actor),
		);
	},
});
