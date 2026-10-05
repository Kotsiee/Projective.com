import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { StageInviteInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/members/stage-invite` — thin route: Zod-validate an invitation of a member
 * already on the roster onto further stages and delegate to the fat
 * {@link ProjectBackendService.inviteMemberToStages}. Ownership is the RPC's own gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to manage members." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = StageInviteInputSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.inviteMemberToStages(parsed.data, actor));
	},
});
