import { define } from "@web/utils/state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET /api/projects/messages?projectId=…&channelId=…&before=…&limit=…` — thin route: guard the
 * required channel identifiers + parse the optional scroll-up cursor, then delegate to the fat
 * {@link ProjectBackendService} for a bottom-anchored page of the channel's conversation (the feed the
 * chat view virtualizes). `before` is the load-older cursor; omit it for the latest page.
 */
export const handler = define.handlers({
	GET(ctx) {
		const projectId = ctx.url.searchParams.get("projectId");
		const channelId = ctx.url.searchParams.get("channelId");
		if (!projectId || !channelId) {
			return Response.json(
				{ ok: false, message: "Missing projectId or channelId." },
				{ status: 400 },
			);
		}
		const before = ctx.url.searchParams.get("before");
		const limitRaw = ctx.url.searchParams.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		return toProjectsResponse(
			ProjectBackendService.messages({
				projectId,
				channelId,
				before: before || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}),
		);
	},
});
