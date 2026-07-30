import { define } from "@web/utils/state.ts";
import { UpdateMemberInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/member` — thin route: Zod-validate the membership patch (role · per-member granted
 * and revoked capabilities · a business spend envelope · soft removal), then delegate to the fat
 * {@link WorkspaceBackendService.updateMember}.
 *
 * This is the write behind the three-layer permission model (role ∪ granted − revoked), and every one of
 * its guards is the service's: an actor may not grant a capability they do not hold, may not manage a
 * member who outranks them, and may not remove or demote the LAST owner (`409`) — that last one is why the
 * refreshed detail matters, since the matrix must revert a refused toggle rather than keep showing it as
 * applied.
 *
 * Removal is `remove: true`, which moves the member to `left`; nothing is hard-deleted (root CLAUDE.md §5).
 *
 * **No server-side capability guard** — `manage_roles` / `remove_members` authority is the fat service's
 * decision, and the Dev Context Switcher must reach the roster as a simulated role. Deferred RLS is the
 * real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpdateMemberInputSchema.safeParse(raw);
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
		return toWorkspaceResponse(WorkspaceBackendService.updateMember(parsed.data, viewer));
	},
});
