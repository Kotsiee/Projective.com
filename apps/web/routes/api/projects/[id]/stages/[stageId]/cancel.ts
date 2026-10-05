import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CancelStageFairExitSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/:id/stages/:stageId/cancel` — thin route: validate the Fair Exit tier and
 * delegate to the fat {@link ProjectBackendService.cancelStageFairExit}, which settles the stage's
 * held escrow through `projects.cancel_stage_fair_exit`.
 *
 * Body: `{ tier: 25 | 50 | 75 }` — the freelancer's share in percent (`finance-model.md` §3). The
 * address comes from the URL and is never read from the body.
 *
 * **No capability guard** — the function's review-authority check is the gate (Decision #53(b)); the
 * 401 below only establishes who the decision belongs to.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to cancel a stage." }, { status: 401 });
		}

		const raw = await ctx.req.json().catch(() => null) as { tier?: unknown } | null;
		const parsed = CancelStageFairExitSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
			tier: raw?.tier,
		});
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Choose a Fair Exit tier of 25, 50 or 75%.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.cancelStageFairExit(parsed.data, actor));
	},
});
