import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/role-delete` — thin route: validate the role reference, then delegate to the fat
 * {@link WorkspaceBackendService.deleteRole}.
 *
 * A POST rather than a DELETE for one reason: it is reached through the same `apiFetch` JSON transport as
 * every other workspace mutation, and giving one write its own verb + body convention buys nothing while
 * costing a second code path in the client service. The `-delete` suffix keeps the intent legible in the
 * route table.
 *
 * Deleting a role that anybody still holds is refused (`409`) rather than reassigning them — nobody is
 * silently demoted, and the matrix explains who is blocking it. A preset role cannot be deleted at all.
 *
 * **No server-side capability guard** — `manage_roles` authority is the fat service's decision, and the Dev
 * Context Switcher must reach the matrix as a simulated role. Deferred RLS is the real gate.
 */

/**
 * The payload contract, declared LOCALLY: the SSOT carries an input schema for every payload-bearing
 * mutation, but this is a bare id pair whose fat signature takes positional arguments, so an SSOT schema
 * would imply a domain shape that does not exist.
 */
const BodySchema = z.object({
	workspaceId: z.string().min(1, "Which workspace?").max(64),
	roleId: z.string().min(1, "Which role?").max(64),
});

export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = BodySchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Invalid role reference.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(
			WorkspaceBackendService.deleteRole(parsed.data.workspaceId, parsed.data.roleId, viewer),
		);
	},
});
