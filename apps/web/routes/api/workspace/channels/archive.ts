import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ArchiveChannelInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/channels/archive` — thin route: refuse a guest, Zod-validate `{ kind, id,
 * channelId }`, then delegate to the fat {@link WorkspaceBackendService.archiveChannel} (Decision #306).
 *
 * A channel is ARCHIVED, never deleted (root CLAUDE.md §5): it leaves the list and takes no new
 * message, and its history stays. Only its creator or a `manage_settings` holder may; the default
 * channel never can. Resolves the FULL re-read detail.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = ArchiveChannelInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid channel reference.");
		return toWorkspaceResponse(await WorkspaceBackendService.archiveChannel(parsed.data, actor));
	},
});
