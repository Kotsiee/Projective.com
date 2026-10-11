import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RequestPaidRevisionSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/:id/stages/:stageId/submissions/:submissionId/paid-revision` — thin route: raise
 * a paid revision round once the stage's free ones are used (Decision #167) and delegate to
 * {@link ProjectBackendService.requestPaidRevision} (`projects.request_paid_revision`).
 *
 * Body: `{ notes: string }`. Nothing is charged here; the answer names the round
 * (`{ revisionId, priceMinor, currency, title }`) that the review's Buy Now adds as a `paid_revision`
 * basket line. Review authority is the function's own check, as for a verdict.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to buy a revision." }, { status: 401 });
		}

		const raw = await ctx.req.json().catch(() => null) as { notes?: unknown } | null;
		const parsed = RequestPaidRevisionSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
			submissionId: ctx.params.submissionId,
			notes: raw?.notes,
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const key = issue?.path.map(String).join(".") || "form";
			const message = issue?.message ?? "Check the highlighted fields.";
			return Response.json({ ok: false, message, errors: { [key]: message } }, { status: 422 });
		}

		return toProjectsResponse(await ProjectBackendService.requestPaidRevision(parsed.data, actor));
	},
});
