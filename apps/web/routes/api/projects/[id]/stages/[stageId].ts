import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { DeleteStageSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `DELETE /api/projects/:id/stages/:stageId` — thin route: the setup form's Remove (PROJECTS ST2).
 * `:id` is the project's `prj-…` slug and `:stageId` the stage's `stg-…` slug; a uuid is refused
 * 422 (Decision #88). Delegates to the fat {@link ProjectBackendService.deleteStage}, whose door,
 * `projects.delete_stage`, hard-deletes a stage nobody claimed, funded or submitted against and
 * refuses any other `409 stage_has_history` before anything moves.
 *
 * **No capability guard** (Decision #53(b)): the door's `can_edit_project_details` check is the gate.
 * The 401 below only establishes who the removal belongs to. The DEV-ONLY `sim` rides the query
 * string, as on the setup save.
 */
export const handler = define.handlers({
	async DELETE(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to remove a stage." }, { status: 401 });
		}

		const parsed = DeleteStageSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That stage address is not valid." },
				{ status: 422 },
			);
		}

		return toProjectsResponse(
			await ProjectBackendService.deleteStage(parsed.data, actor, ctx.url.searchParams.get("sim")),
		);
	},
});
