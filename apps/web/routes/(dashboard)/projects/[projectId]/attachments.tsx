import { define } from "@web/utils/state.ts";

/**
 * Legacy `/projects/[projectId]/attachments` → the project-scoped File Explorer. Historical
 * attachment links resolve here and are permanently folded into `/files` (where Channels are the tree
 * top level). A static `attachments` segment takes precedence over the `[channelId]` dynamic, so this
 * never shadows a real channel.
 */
export const handler = define.handlers({
	GET(ctx) {
		return new Response(null, {
			status: 308,
			headers: { location: `/projects/${ctx.params.projectId}/files` },
		});
	},
});
