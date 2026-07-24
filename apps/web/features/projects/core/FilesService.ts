import { getProjects } from "./api.ts";
import type { FileListPage, FileListParams, FileScope } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * FilesService — the dumb client service for the File Explorer read. It builds the query string and
 * calls the transport helper {@link getProjects}, returning a soft {@link ProjectsResult}; it never
 * throws, so the explorer island stays dumb (mirrors {@link MessagesService}). All refinement — sort,
 * filter, free-text, scroll-load paging — flows through this one `list` call.
 *
 * **Scope routing.** The explorer is mounted by BOTH route hierarchies, so the endpoint is chosen from
 * the scope rather than duplicated per feature: an engagement scope reads `/api/projects/files`, the
 * global-inbox `conversation` scope reads `/api/messaging/files`. Both answer the identical
 * `FileListPage` contract, so nothing downstream of this function differs.
 */
export const FilesService = {
	list(
		params: FileListParams & { scope?: FileScope },
	): Promise<ProjectsResult<{ page: FileListPage }>> {
		const conversation = params.scope === "conversation";
		const qs = new URLSearchParams(
			conversation
				? { conversationId: params.channelId || params.projectId }
				: { projectId: params.projectId },
		);
		if (!conversation && params.channelId) qs.set("channelId", params.channelId);
		if (params.sort) qs.set("sort", params.sort);
		if (params.dir) qs.set("dir", params.dir);
		if (params.kinds && params.kinds.length > 0) qs.set("kinds", params.kinds.join(","));
		if (params.query) qs.set("query", params.query);
		if (params.cursor) qs.set("cursor", params.cursor);
		if (params.limit) qs.set("limit", String(params.limit));
		const base = conversation ? "/api/messaging/files" : "/api/projects/files";
		return getProjects<{ page: FileListPage }>(`${base}?${qs.toString()}`);
	},
};
