import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateWorkspaceInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/create` — thin route: refuse a guest, Zod-validate the Draft-First payload (kind +
 * name + handle), then delegate to the fat {@link WorkspaceBackendService.create}, which creates the
 * entity with the caller as its owner. A `201` with `{ id, kind, handle }` — the caller navigates into
 * the new console, which is addressed by its handle and resolves its own detail.
 *
 * The handle is re-validated server-side even though the form probes `/api/workspace/handle` first — the
 * probe is an affordance, not a lock, and two people can pass it for the same handle in the same second.
 * The plan's creation cap is the database's decision, refused with a human reason.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = CreateWorkspaceInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error);
		return toWorkspaceResponse(await WorkspaceBackendService.create(parsed.data, actor));
	},
});
