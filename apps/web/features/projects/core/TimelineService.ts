import { getProjects } from "./api.ts";
import type { TimelineListParams, TimelinePage } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * TimelineService — the dumb client service for the Timeline / Gantt read. It builds the query string
 * and calls the transport helper, returning a soft {@link ProjectsResult}; it never throws, so the
 * timeline island stays dumb (mirrors {@link BoardService}). The timeline loads once per scope; every
 * write it makes goes through {@link BoardService} — a ticket created from the Gantt is the same
 * ticket the board would have created, through the same endpoint.
 */
export const TimelineService = {
	list(params: TimelineListParams): Promise<ProjectsResult<{ page: TimelinePage }>> {
		const qs = new URLSearchParams({ projectId: params.projectId });
		if (params.channelId) qs.set("channelId", params.channelId);
		return getProjects<{ page: TimelinePage }>(`/api/projects/timeline?${qs.toString()}`);
	},
};
