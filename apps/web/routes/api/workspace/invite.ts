import { define } from "@web/utils/state.ts";
import { InviteMemberInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite` — thin route: Zod-validate the invitation (handle OR email, plus the role
 * to offer), then delegate to the fat {@link WorkspaceBackendService.invite}.
 *
 * The SSOT schema makes both targets optional because exactly one is required, which a flat object schema
 * cannot express without forking the shape; the service resolves it via `inviteTargetOf` and refuses a
 * target-less invite. **The route does not second-guess that** — re-deriving the rule here would give the
 * same mistake two different messages depending on which layer noticed first.
 *
 * The role is re-checked server-side against the inviter's own authority: nobody may hand out
 * capabilities they do not hold, and a duplicate invitation comes back `409` rather than silently
 * stacking a second pending offer on one person.
 *
 * **No server-side capability guard** — `invite_members` authority is the fat service's decision, and the
 * Dev Context Switcher must reach the roster as a simulated role. Deferred RLS is the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = InviteMemberInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Check the highlighted fields.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(WorkspaceBackendService.invite(parsed.data, viewer));
	},
});
