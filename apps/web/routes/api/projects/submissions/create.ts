import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateSubmissionSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/submissions/create` — thin route: Zod-validate one deliverable and delegate to
 * the fat {@link ProjectBackendService}, which returns the created unit.
 *
 * `submit` is the whole difference between a private working copy and the start of somebody else's
 * clock: a draft stays editable, `pending_review` is a delivery claim that puts the engagement in
 * front of a reviewer. Both go through this one route because they are the same write with one
 * different field, and two endpoints would be two places for the file-linking to drift.
 *
 * As with the composer, `fileIds` are `files.items` ids uploaded through the files handshake before
 * this call — bytes never transit an application route.
 *
 * **No capability guard.** Whether this identity may deliver against this stage is answered by RLS on
 * `projects.stage_submissions` (whose INSERT policy carries a stage-access arm alongside
 * `submitted_by = auth.uid()`), not by a route-level bounce, which would fire on a simulated Dev
 * Context persona (Decision #53(b)). The 401 only establishes who the submission belongs to.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to create a submission." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateSubmissionSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.createSubmission(parsed.data, actor));
	},
});
