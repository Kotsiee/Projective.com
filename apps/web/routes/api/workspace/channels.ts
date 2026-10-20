import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateChannelInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/channels` — thin route: refuse a guest, Zod-validate `{ kind, id, name, topic? }`,
 * then delegate to the fat {@link WorkspaceBackendService.createChannel} (Decision #306).
 *
 * Any active member of a non-archived team or business may add a channel. The name is normalised and
 * judged by the database (a refusal comes back keyed to `name`); a duplicate is `409`, the 30-channel
 * cap `409`. Resolves the FULL re-read detail, whose `channels` now hold the new one.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = CreateChannelInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid channel.");
		return toWorkspaceResponse(await WorkspaceBackendService.createChannel(parsed.data, actor));
	},
});
