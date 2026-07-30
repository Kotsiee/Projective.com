import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET /api/workspace/handle?handle=…` — thin route: probe a handle's availability for the create form,
 * delegating to the fat {@link WorkspaceBackendService.checkHandle} (format → reserved words →
 * collisions, with suggested alternatives).
 *
 * **A malformed handle is a 200, not a 422.** The service answers `{ available: false, reason }` for
 * bad format, a reserved word and a collision alike, so the form renders one consistent, human
 * explanation from one code path. Rejecting malformed input at the route would split that into two
 * presentations of the same idea and lose the suggestions. Only an ABSENT handle is a validation error —
 * there is nothing to probe.
 *
 * **No server-side capability guard** — the Dev Context Switcher must reach the create flow as a
 * simulated persona (the server never sees that seam); the deferred RLS on the live path is the real
 * gate. This read discloses only whether a handle is free, which is already public by construction (a
 * taken handle resolves at `/[handle]`).
 */

/** The query contract. `max` matches the SSOT's handle ceiling so unbounded input never reaches the service. */
const QuerySchema = z.object({
	handle: z.string().min(1, "Enter a handle.").max(40, "Handles are at most 40 characters."),
});

export const handler = define.handlers({
	GET(ctx) {
		const parsed = QuerySchema.safeParse({ handle: ctx.url.searchParams.get("handle") });
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Enter a handle to check.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		return toWorkspaceResponse(WorkspaceBackendService.checkHandle(parsed.data.handle));
	},
});
