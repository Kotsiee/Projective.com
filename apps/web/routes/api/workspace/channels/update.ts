import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { UpdateChannelInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/channels/update` — thin route: refuse a guest, Zod-validate `{ kind, id,
 * channelId, name, topic, emoji }`, then delegate to the fat
 * {@link WorkspaceBackendService.updateChannel} (Decision #308).
 *
 * Every field is replaced and a blank one cleared. The slug — the channel's address — never changes, so
 * a rename never breaks a link. Only its creator or a `manage_settings` holder may. Resolves the FULL
 * re-read detail.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = UpdateChannelInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Check the channel's details.");
		return toWorkspaceResponse(await WorkspaceBackendService.updateChannel(parsed.data, actor));
	},
});
