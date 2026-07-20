import { getProjects } from "./api.ts";
import type { FileListPage, FileListParams } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * FilesService — the dumb client service for the File Explorer read. It builds the query string and
 * calls the transport helper {@link getProjects}, returning a soft {@link ProjectsResult}; it never
 * throws, so the explorer island stays dumb (mirrors {@link MessagesService}). All refinement — sort,
 * filter, free-text, scroll-load paging — flows through this one `list` call.
 */
export const FilesService = {
	list(params: FileListParams): Promise<ProjectsResult<{ page: FileListPage }>> {
		const qs = new URLSearchParams({ projectId: params.projectId });
		if (params.channelId) qs.set("channelId", params.channelId);
		if (params.sort) qs.set("sort", params.sort);
		if (params.dir) qs.set("dir", params.dir);
		if (params.kinds && params.kinds.length > 0) qs.set("kinds", params.kinds.join(","));
		if (params.query) qs.set("query", params.query);
		if (params.cursor) qs.set("cursor", params.cursor);
		if (params.limit) qs.set("limit", String(params.limit));
		return getProjects<{ page: FileListPage }>(`/api/projects/files?${qs.toString()}`);
	},
};
