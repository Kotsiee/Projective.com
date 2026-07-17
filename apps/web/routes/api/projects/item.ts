import { define } from "@web/utils/state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET /api/projects/item?slug=…` — thin route: guard the required slug, then delegate to the fat
 * {@link ProjectBackendService} for a single engagement projection (deep-link prefetch / row focus).
 */
export const handler = define.handlers({
	GET(ctx) {
		const slug = ctx.url.searchParams.get("slug");
		if (!slug) {
			return Response.json({ ok: false, message: "Missing project slug." }, { status: 400 });
		}
		return toProjectsResponse(ProjectBackendService.item(slug));
	},
});
