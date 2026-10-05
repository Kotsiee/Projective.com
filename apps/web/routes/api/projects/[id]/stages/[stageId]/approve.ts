import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ApproveStageSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/:id/stages/:stageId/approve` — thin route: validate the address and delegate
 * to the fat {@link ProjectBackendService.approveStage}, which releases the stage's held escrow
 * through `projects.approve_stage`.
 *
 * `:id` is the project slug, as on every `/api/projects/:id` route; `:stageId` is the stage's `stg-…`
 * slug or its uuid. The address is the whole request — there is no body to trust.
 *
 * **No capability guard.** Whether this identity may approve is answered by the function's own
 * review-authority check (`projects.can_review_project`), which refuses a freelancer — the payee
 * included — with a 403 before anything moves. A route-level owner bounce would fire on a simulated
 * Dev Context persona (Decision #53(b)). The 401 below only establishes who the decision belongs to.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to approve a stage." }, { status: 401 });
		}

		const parsed = ApproveStageSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That stage address is not valid." },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.approveStage(parsed.data, actor));
	},
});
