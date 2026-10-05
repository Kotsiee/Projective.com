import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ReviewSubmissionSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/:id/stages/:stageId/submissions/:submissionId/review` — thin route: validate
 * one reviewer verdict and delegate to the fat {@link ProjectBackendService.reviewSubmission}, which
 * records it through `projects.review_submission`.
 *
 * Body: `{ decision: "accept" | "request_revision", notes?: string }`. A revision request without
 * notes is refused here (422 on `notes`) — the freelancer would have nothing to act on. The address
 * comes from the URL; the service checks the submission actually belongs to the stage it names.
 *
 * **No capability guard** — the function's review-authority check is the gate, and it refuses the
 * submitter 403 (Decision #53(b)); the 401 below only establishes who the verdict belongs to.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to review a submission." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null) as
			| { decision?: unknown; notes?: unknown }
			| null;
		const parsed = ReviewSubmissionSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
			submissionId: ctx.params.submissionId,
			decision: raw?.decision,
			notes: raw?.notes ?? undefined,
		});
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: errors.notes ?? "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.reviewSubmission(parsed.data, actor));
	},
});
