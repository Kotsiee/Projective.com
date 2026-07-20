import { define } from "@web/utils/state.ts";

/**
 * Legacy `/projects/[projectId]/[channelId]/attachments` → the channel's Files tab. Historical
 * per-channel attachment links fold permanently into `/files`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const { projectId, channelId } = ctx.params;
		return new Response(null, {
			status: 308,
			headers: { location: `/projects/${projectId}/${channelId}/files` },
		});
	},
});
