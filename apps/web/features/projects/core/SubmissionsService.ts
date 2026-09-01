import { getProjects, postProjects } from "./api.ts";
import type {
	CreateSubmission,
	SubmissionListPage,
	SubmissionListParams,
	SubmissionUnit,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * SubmissionsService — the dumb client service for the Submissions explorer. It builds the query
 * string (the tree `path` is joined back into a single slash-delimited param) or the JSON body and
 * calls the transport helpers, returning a soft {@link ProjectsResult}; it never throws, so the
 * explorer island stays dumb (mirrors {@link FilesService}). All navigation + refinement — tree path,
 * sort, filter, free-text, scroll-load paging — flows through the one `list` call.
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
		if (params.asFreelancer !== undefined) qs.set("asFreelancer", params.asFreelancer ? "1" : "0");
		if (params.cursor) qs.set("cursor", params.cursor);
		if (params.limit) qs.set("limit", String(params.limit));
		return getProjects<{ page: SubmissionListPage }>(`/api/projects/submissions?${qs.toString()}`);
	},

	/**
	 * Create a submission unit against a stage.
	 *
	 * `submit` is the whole difference between saving and delivering: a draft stays editable, while
	 * `pending_review` starts the client's clock. One call for both, because they are the same write
	 * with one field changed and two would be two places for the file-linking to drift.
	 *
	 * `fileIds` are `files.items` ids uploaded through the files handshake beforehand — see
	 * {@link uploadForProject}.
	 */
	create(payload: CreateSubmission): Promise<ProjectsResult<{ unit: SubmissionUnit }>> {
		return postProjects<{ unit: SubmissionUnit }>("/api/projects/submissions/create", payload);
	},
};
