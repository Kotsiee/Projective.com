import { getProjects } from "./api.ts";
import type { BoardListParams, BoardPage } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * BoardService — the dumb client service for the Kanban board read. It builds the query string and calls
 * the transport helper {@link getProjects}, returning a soft {@link ProjectsResult}; it never throws, so
 * the board island stays dumb (mirrors {@link FilesService}). The board loads its full card set once per
 * scope + grouping; search/priority/assignee filtering is applied client-side. A grouping switch
 * (Stages ⁄ Statuses) is the one refine that re-`list`s (different columns).
 */
export const BoardService = {
	list(params: BoardListParams): Promise<ProjectsResult<{ page: BoardPage }>> {
		const qs = new URLSearchParams({ projectId: params.projectId });
		if (params.channelId) qs.set("channelId", params.channelId);
		if (params.view) qs.set("view", params.view);
		if (params.query) qs.set("query", params.query);
		if (params.assignee) qs.set("assignee", params.assignee);
		if (params.priority) qs.set("priority", params.priority);
		return getProjects<{ page: BoardPage }>(`/api/projects/board?${qs.toString()}`);
	},
};
