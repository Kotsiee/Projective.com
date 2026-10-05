import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { RejectApplicationSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/applications/reject` `{ applicationId }` — the client declines an applicant.
 * Zod-validated, then the fat {@link ProjectBackendService.rejectApplication}; on the live path
 * `projects.reject_application`, which is owner-only and refuses an application already answered.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to decline an applicant." }, {
				status: 401,
			});
		}
		const parsed = RejectApplicationSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Name the application to decline.",
					errors: { applicationId: "required" },
				},
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.rejectApplication(parsed.data, actor));
	},
});
