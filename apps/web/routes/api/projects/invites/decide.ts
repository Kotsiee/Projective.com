import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteDecisionInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/invites/decide` — DEVELOPMENT ONLY. Force an invitee's answer to one of the
 * caller's own invitations (`accept` · `decline`), so the Dev Tools Invites window can walk an invite
 * flow through every state without a second account.
 *
 * The route validates the shape and hands off; the gate is the SERVER's `DENO_ENV`, read inside the
 * fat {@link ProjectBackendService.decideInvite}, which answers a plain 404 anywhere but development
 * — a request cannot assert its way past it, and the Dev Tools island that calls this is itself
 * absent from a production bundle (`DevMount`). On the live path the write runs the SAME
 * `projects.fn_apply_invitation_decision` the invitee's own answer runs, through the service role,
 * after the row has been read back under the caller's RLS as its inviter.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to manage invitations." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = InviteDecisionInputSchema.safeParse(raw);
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

		return toProjectsResponse(await ProjectBackendService.decideInvite(parsed.data, actor));
	},
});
