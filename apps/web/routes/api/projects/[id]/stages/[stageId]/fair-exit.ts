import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { PreviewStageFairExitSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET /api/projects/:id/stages/:stageId/fair-exit` — thin route: validate the address and delegate to
 * the fat {@link ProjectBackendService.previewStageFairExit}, which reads what ending the stage under
 * Fair Exit would settle at each tier through `projects.preview_stage_fair_exit` (Decision #198).
 *
 * The Fair Exit confirmation renders these figures as they come — the island does no money math.
 *
 * **No capability guard** — the function's review-authority check is the gate (Decision #53(b)); the
 * 401 below only establishes who is asking.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to end a stage." }, { status: 401 });
		}

		const parsed = PreviewStageFairExitSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That stage address is not valid." },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.previewStageFairExit(parsed.data, actor));
	},
});
