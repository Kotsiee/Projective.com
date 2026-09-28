import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateWorkspaceInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/update` — thin route: refuse a guest, Zod-validate the identity/lifecycle patch
 * (name · tagline · status), then delegate to the fat {@link WorkspaceBackendService.update}.
 *
 * A patch, not a replace: every field is optional, so a caller sends only what changed. Archiving goes
 * through `status` — nothing on this surface is hard-deleted (root CLAUDE.md §5). Pictures are not here:
 * they move through the media pipeline on the entity's profile editor (`/@handle/edit`).
 *
 * Resolves the FULL re-read detail, so the editor re-seeds from what the server actually stored.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpdateWorkspaceInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.update(parsed.data, actor));
	},
});
