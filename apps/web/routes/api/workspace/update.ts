import { define } from "@web/utils/state.ts";
import { UpdateWorkspaceInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/update` — thin route: Zod-validate the identity/settings patch (name · tagline ·
 * mark · banner · lifecycle status), then delegate to the fat {@link WorkspaceBackendService.update}.
 *
 * A patch, not a replace: every field is optional, so a settings panel sends only what changed and can
 * never blank a field it does not render. Archiving goes through `status` — nothing on this surface is
 * hard-deleted (root CLAUDE.md §5), so there is no delete endpoint to omit.
 *
 * Resolves the FULL refreshed detail, like every mutation here, so the editor re-seeds from what the
 * server actually stored rather than trusting its optimistic copy.
 *
 * **No server-side capability guard** — `edit_profile` / `manage_settings` / `archive_entity` authority is
 * the fat service's decision (it refuses `403` with the reason), and the Dev Context Switcher must reach
 * the console as a simulated role. Deferred RLS on the live path is the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpdateWorkspaceInputSchema.safeParse(raw);
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
		return toWorkspaceResponse(WorkspaceBackendService.update(parsed.data, viewer));
	},
});
