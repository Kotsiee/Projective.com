import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { AcceptApplicationSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/applications/accept` `{ applicationId }` — the client confirms an applicant's
 * seat. Zod-validated, then the fat {@link ProjectBackendService.acceptApplication}; on the live path
 * `projects.assign_from_application`, which is owner-only and guarded against double-booking.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to confirm a seat." }, { status: 401 });
		}
		const parsed = AcceptApplicationSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Name the application to accept.",
					errors: { applicationId: "required" },
				},
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.acceptApplication(parsed.data, actor));
	},
});
