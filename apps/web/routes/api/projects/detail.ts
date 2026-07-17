import { define } from "@web/utils/state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET /api/projects/detail?slug=…` — thin route: guard the required slug, then delegate to the fat
 * {@link ProjectBackendService} for the deep single-engagement projection the Project Details sidebar
 * (`/projects/[projectId]`) hydrates from (contextual header · view links · members · channel tree).
 */
export const handler = define.handlers({
	GET(ctx) {
		const slug = ctx.url.searchParams.get("slug");
		if (!slug) {
			return Response.json({ ok: false, message: "Missing project slug." }, { status: 400 });
		}
		return toProjectsResponse(ProjectBackendService.detail(slug));
	},
});
