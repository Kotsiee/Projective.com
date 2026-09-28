import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import type { HandleCheck } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceBody,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/workspace/handle?handle=…` — thin route: probe a handle's availability for
 * the create form, delegating to the fat {@link WorkspaceBackendService.checkHandle} (format → reserved
 * words → collisions across the one shared handle namespace).
 *
 * **A malformed handle is a 200, not a 422.** The service answers `{ available: false, reason }` for bad
 * format, a reserved word and a collision alike, so the form renders one consistent explanation from one
 * code path. Only an ABSENT handle is a validation error — there is nothing to probe.
 *
 * Signed-in only: the probe exists to serve the create form, and an anonymous handle scanner is not a
 * caller this route owes an answer to.
 */
const QuerySchema = z.object({
	handle: z.string().min(1, "Enter a handle.").max(40, "Handles are at most 40 characters."),
});

export const handler = define.handlers(
	defineReadRoute<HandleCheck>({
		resolve: (ctx) => {
			const actor = readActor(ctx);
			if (!canReadLive(actor)) return guestRefusal();
			const parsed = QuerySchema.safeParse({ handle: ctx.url.searchParams.get("handle") });
			if (!parsed.success) return invalidPayload(parsed.error, "Enter a handle to check.");
			return WorkspaceBackendService.checkHandle(parsed.data.handle, actor);
		},
		toBody: toWorkspaceBody,
	}),
);
