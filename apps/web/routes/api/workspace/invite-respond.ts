import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/invite-respond` — thin route: validate the decision, then delegate to the fat
 * {@link WorkspaceBackendService.respondInvite} to accept or decline an invitation addressed to the
 * VIEWER.
 *
 * Resolves the refreshed ROSTER rather than a detail — the viewer answers from the roster index, and an
 * acceptance changes which entities they belong to, so the roster is precisely the thing that just became
 * stale. Deciding an already-decided invitation comes back `409`, so a double-click cannot re-accept.
 *
 * The invitation is matched to the viewer server-side; the route deliberately does not check "is this
 * mine", because an id-based ownership test belongs beside the store that holds the row.
 *
 * **No server-side capability guard** — answering one's own invitation needs no capability, and the Dev
 * Context Switcher must reach the roster as a simulated persona. Deferred RLS is the real gate.
 */

/**
 * The payload contract, declared LOCALLY on purpose: the workspace SSOT carries an input schema for every
 * payload-BEARING mutation, but this one is a bare id + decision tuple whose fat signature takes
 * positional arguments rather than an input object. Inventing an SSOT schema for it would imply a domain
 * shape that does not exist.
 */
const BodySchema = z.object({
	inviteId: z.string().min(1, "Which invitation?").max(64),
	accept: z.boolean(),
});

export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = BodySchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Invalid invitation response.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(
			WorkspaceBackendService.respondInvite(parsed.data.inviteId, parsed.data.accept, viewer),
		);
	},
});
