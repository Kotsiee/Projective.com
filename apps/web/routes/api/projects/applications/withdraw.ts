import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { WithdrawApplicationSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/applications/withdraw` `{ applicationId }` — the applicant takes a pending
 * proposal back. Zod-validated, then the fat {@link ProjectBackendService.withdrawApplication}; on the
 * live path `projects.withdraw_application`, whose status flip refunds one weekly proposal unit.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to withdraw a proposal." }, {
				status: 401,
			});
		}
		const parsed = WithdrawApplicationSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Name the application to withdraw.",
					errors: { applicationId: "required" },
				},
				{ status: 422 },
			);
		}
		return toProjectsResponse(await ProjectBackendService.withdrawApplication(parsed.data, actor));
	},
});
