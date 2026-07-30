import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { WorkspaceKind } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { simFromParams } from "@features/workspaces/core/workspace-seam.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET /api/workspace/detail?kind=team|business&id=…` — thin route: validate the kind + id, resolve the
 * acting context, then delegate to the fat {@link WorkspaceBackendService.detail} for the entity's full
 * console projection (roster · roles · invites · money policy · projects · activity · setup checklist ·
 * the viewer's server-resolved effective capabilities).
 *
 * Refusals come straight from the service and are deliberately distinct: `404` for an entity that does
 * not exist, `403` for one the viewer is not a member of. Collapsing them would either leak the
 * existence of private entities or tell a member their own workspace is gone.
 *
 * **No server-side capability guard** — membership is chrome + deferred RLS, and the Dev Context
 * Switcher must be able to reach this surface as a simulated persona (the server never sees that seam).
 * Per-entity authority is the fat service's decision; the RLS-scoped live path is the real gate.
 */

/** The query contract — an object parse so each issue reaches the client keyed to its own field. */
const QuerySchema = z.object({
	kind: WorkspaceKind,
	id: z.string().min(1, "Which workspace?").max(64),
});

export const handler = define.handlers({
	GET(ctx) {
		const sp = ctx.url.searchParams;
		const parsed = QuerySchema.safeParse({ kind: sp.get("kind"), id: sp.get("id") });
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Invalid workspace reference.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(
			WorkspaceBackendService.detail(
				parsed.data.kind,
				parsed.data.id,
				viewer,
				simFromParams(ctx.url.searchParams),
			),
		);
	},
});
