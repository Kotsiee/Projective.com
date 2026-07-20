import { getProjects } from "./api.ts";
import type { SubmissionListPage, SubmissionListParams } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * SubmissionsService — the dumb client service for the Submissions explorer read. It builds the query
 * string (the tree `path` is joined back into a single slash-delimited param) and calls the transport
 * helper {@link getProjects}, returning a soft {@link ProjectsResult}; it never throws, so the explorer
 * island stays dumb (mirrors {@link FilesService}). All navigation + refinement — tree path, sort,
 * filter, free-text, scroll-load paging — flows through this one `list` call.
 */
export const SubmissionsService = {
	list(params: SubmissionListParams): Promise<ProjectsResult<{ page: SubmissionListPage }>> {
		const qs = new URLSearchParams({ projectId: params.projectId });
		if (params.channelId) qs.set("channelId", params.channelId);
		if (params.path && params.path.length > 0) qs.set("path", params.path.join("/"));
		if (params.sort) qs.set("sort", params.sort);
		if (params.dir) qs.set("dir", params.dir);
		if (params.kinds && params.kinds.length > 0) qs.set("kinds", params.kinds.join(","));
		if (params.query) qs.set("query", params.query);
		if (params.cursor) qs.set("cursor", params.cursor);
		if (params.limit) qs.set("limit", String(params.limit));
		return getProjects<{ page: SubmissionListPage }>(`/api/projects/submissions?${qs.toString()}`);
	},
};
