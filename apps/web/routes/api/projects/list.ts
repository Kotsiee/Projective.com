import { define } from "@web/utils/state.ts";
import { parseProjectParams } from "@features/projects/core/projects-state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `GET /api/projects/list` — thin route: parse the feed query (scope + facets + quick + search),
 * then delegate to the fat {@link ProjectBackendService}, which returns the matched rows, context
 * groups, and the scope + service option matrices. The feed island calls this via
 * `ProjectSidebarService` for every client-side refinement; the `/projects` route handler calls the
 * service directly for SSR first paint.
 */
export const handler = define.handlers({
	GET(ctx) {
		const params = parseProjectParams(ctx.url.searchParams);
		return toProjectsResponse(ProjectBackendService.list(params));
	},
});
