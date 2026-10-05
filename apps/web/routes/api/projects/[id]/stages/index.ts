import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateStageInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/:id/stages` — thin route: Zod-validate a new stage (name + optional brief) and
 * delegate to the fat {@link ProjectBackendService.createStage}. `:id` is the project slug. Answers
 * `201` with the persisted stage as the board projects it.
 *
 * **No capability guard**, for the reason every projects write states (Decision #53(b)): the Dev
 * Context Switcher's persona never reaches the server. `projects.create_stage`'s own owner check is
 * the gate, and its refusal arrives as a typed `403`. The 401 below only establishes an identity.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to add a stage." }, { status: 401 });
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateStageInputSchema.safeParse(raw);
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
			await ProjectBackendService.createStage(ctx.params.id, parsed.data, actor),
		);
	},
});
