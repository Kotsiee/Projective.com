import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { InviteLinkActionInputSchema } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { InviteLinkService } from "@server/services/projects/InviteLinkService.ts";

/**
 * `GET|POST /api/projects/:id/stages/:stageId/invite-link` — thin route over the fat
 * {@link InviteLinkService} (Decision #145).
 *
 * GET reads the stage's active link (never mints one). POST `{ action: "ensure" | "reset" | "revoke" }`
 * mints-or-reads, replaces, or turns it off. The address comes from the URL and is never read from
 * the body; who may share a link is the database's answer (`can_manage_project_members`).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to share an invite link." }, {
				status: 401,
			});
		}
		return toProjectsResponse(
			await InviteLinkService.stageLink(ctx.params.id, ctx.params.stageId, actor),
		);
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to share an invite link." }, {
				status: 401,
			});
		}
		const raw = await ctx.req.json().catch(() => null) as { action?: unknown } | null;
		const parsed = InviteLinkActionInputSchema.safeParse({
			projectId: ctx.params.id,
			stageId: ctx.params.stageId,
			action: raw?.action,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Choose ensure, reset or revoke.", errors: { action: "invalid" } },
				{ status: 422 },
			);
		}
		return toProjectsResponse(await InviteLinkService.act(parsed.data, actor));
	},
});
