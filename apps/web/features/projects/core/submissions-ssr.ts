import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { SubmissionListPage } from "../types/projects-types.ts";

/**
 * submissions-ssr — the server-only bootstrap for the Submissions explorer's first paint. Calls the fat
 * {@link ProjectBackendService.submissions} directly (no HTTP hop) so the explorer ships its first page
 * of files + the navigation tree + the breadcrumb trail in the initial byte; the island then refines /
 * navigates via the thin {@link SubmissionsService}. The `path` is the catch-all route's trailing
 * segments, so a deep-linked tree node (or a hard refresh on one) resolves to the right initial scope.
 * Mirrors {@link resolveFilePage}. Never imported by an island.
 */
export interface SubmissionBootstrap {
	page: SubmissionListPage | null;
}

/**
 * Resolve the initial submissions page. `channelId` unset → project scope (Stages as tree roots);
 * `path` selects the initial tree node (segment chain), `[]`/undefined = the scope root.
 */
export function resolveSubmissionPage(
	projectId: string,
	channelId?: string | null,
	path?: string[],
): SubmissionBootstrap {
	const res = ProjectBackendService.submissions({
		projectId,
		channelId: channelId ?? null,
		path: path && path.length > 0 ? path : undefined,
	});
	return { page: res.ok && res.data ? res.data.page : null };
}
