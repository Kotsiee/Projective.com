import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpsertRoleInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/role` — thin route: refuse a guest, Zod-validate the custom-role payload (name ·
 * summary · capabilities · the preset it ranks as, with `roleId` absent when creating), then delegate to
 * the fat {@link WorkspaceBackendService.upsertRole}.
 *
 * One endpoint for create and edit because they are the same write with and without an id. Preset roles
 * are read-only (`422`); a capability the author does not hold, or a base preset above their own rank,
 * is refused rather than silently narrowed — a narrowed role would look saved while granting less.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpsertRoleInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.upsertRole(parsed.data, actor));
	},
});
