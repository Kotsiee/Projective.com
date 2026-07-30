import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { WorkspaceKind } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { simFromParams } from "@features/workspaces/core/workspace-seam.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET /api/workspace/roster?kind=team|business` — thin route: validate the entity kind, resolve the
 * acting context, then delegate to the fat {@link WorkspaceBackendService.roster} for every entity of
 * that kind the viewer belongs to plus the invitations awaiting them.
 *
 * The body is the roster ITSELF, unwrapped, exactly as the fat method returns it — so this route is a
 * single `toWorkspaceResponse` pass-through with nothing to re-wrap, and the client's
 * `WorkspaceService.roster` shape cannot drift from the service's.
 *
 * **No server-side capability guard.** Entity membership is chrome + deferred RLS: the client-side Dev
 * Context Switcher simulates personas the server never sees, so a route that gated on
 * `isFreelancer`/membership would make half the surface unreachable in development. The fat service
 * refuses per-entity (403 for a non-member) and the RLS-scoped live path is the real gate — matching
 * every sibling `/api/*` read (catalogue, wallet, projects).
 */

/**
 * The query contract. Parsed as an OBJECT rather than by calling `WorkspaceKind.safeParse` directly so
 * the issue carries a `kind` path — a bare enum parse produces a path-less issue that
 * {@link toFieldErrors} can only key as `form`, which is not what the caller can act on.
 */
const QuerySchema = z.object({ kind: WorkspaceKind });

export const handler = define.handlers({
	GET(ctx) {
		const parsed = QuerySchema.safeParse({ kind: ctx.url.searchParams.get("kind") });
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Unknown entity kind.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		// The developer simulation overlay travels as query params because the Dev Context Switcher is a
		// client-side seam the server cannot see. It is validated against the SSOT and ignored on the live
		// path, so it changes what this developer's own request is answered with and nothing else.
		const sim = simFromParams(ctx.url.searchParams);
		return toWorkspaceResponse(WorkspaceBackendService.roster(parsed.data.kind, viewer, sim));
	},
});
