import { define } from "@web/utils/state.ts";
import { CreateWorkspaceInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/create` — thin route: Zod-validate the Draft-First payload (kind + name + handle,
 * optional logo), map issues to field errors, then delegate to the fat
 * {@link WorkspaceBackendService.create} with the viewer as the new entity's owner.
 *
 * Resolves the roster SUMMARY, not a full console projection: the caller's next move is to navigate into
 * the entity, whose route resolves its own detail server-side, so shipping the whole console here would
 * be paid for twice. A `201` on success.
 *
 * The handle is re-validated server-side even though the form probes `/api/workspace/handle` first — the
 * probe is an affordance, not a lock, and two people can pass it for the same handle in the same second.
 *
 * **No server-side capability guard** — a plan/ownership cap is the service's decision (it refuses with
 * a human reason the roster renders), and the Dev Context Switcher must be able to create as a simulated
 * persona. Deferred RLS on the live path is the real gate, matching every sibling `/api/*` mutation.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateWorkspaceInputSchema.safeParse(raw);
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
		return toWorkspaceResponse(WorkspaceBackendService.create(parsed.data, viewer));
	},
});
