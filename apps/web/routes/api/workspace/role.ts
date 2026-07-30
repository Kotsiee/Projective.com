import { define } from "@web/utils/state.ts";
import { UpsertRoleInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/role` — thin route: Zod-validate the custom-role payload (name · summary ·
 * capability set, with `roleId` absent when creating), then delegate to the fat
 * {@link WorkspaceBackendService.upsertRole}.
 *
 * One endpoint for create and edit because they are the same write with and without an id — splitting them
 * would duplicate the capability-authority check, which is the only interesting part.
 *
 * Preset roles are READ-ONLY: sending one comes back `422` (the matrix's escape hatch is "duplicate to a
 * custom role"), and a capability the actor does not themselves hold is refused rather than silently
 * dropped — a silently-narrowed role would look saved while granting less than the editor displayed.
 *
 * **No server-side capability guard** — `manage_roles` authority is the fat service's decision, and the Dev
 * Context Switcher must reach the matrix as a simulated role. Deferred RLS is the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpsertRoleInputSchema.safeParse(raw);
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
		return toWorkspaceResponse(WorkspaceBackendService.upsertRole(parsed.data, viewer));
	},
});
