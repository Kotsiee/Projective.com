import { deleteProjects, getProjects, patchProjects, postProjects } from "./api.ts";
import { toSearchParams } from "./projects-state.ts";
import type { ProjectFeedParams } from "./projects-state.ts";
import type {
	ArchiveProject,
	CreateProject,
	ProjectDetail,
	ProjectFeedPayload,
	ProjectSetup,
	ProjectSummary,
	UpdateProject,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * ProjectSidebarService — the THIN client controller for the `/projects` middle-nav feed.
 *
 * A dumb object of named methods; each just builds a query string (or JSON body) and forwards to a
 * `/api/projects/*` route, returning a soft {@link ProjectsResult}. No fixtures, no query logic, no
 * scattered `fetch` — the feed island calls these for every client-side refinement (scope switch,
 * facet change, search) while the fat {@link ProjectBackendService} owns all
 * filtering/sorting/grouping (mirrors `ExploreService`).
 */
export const ProjectSidebarService = {
	/** Fetch the context-scoped feed (rows + groups + scope/service matrices) for a param set. */
	list(params: ProjectFeedParams): Promise<ProjectsResult<ProjectFeedPayload>> {
		const qs = toSearchParams(params).toString();
		return getProjects<ProjectFeedPayload>(`/api/projects/list${qs ? `?${qs}` : ""}`);
	},

	/** Look up a single engagement by slug (deep-link prefetch / row focus). */
	item(slug: string): Promise<ProjectsResult<{ item: ProjectSummary }>> {
		return getProjects<{ item: ProjectSummary }>(
			`/api/projects/item?slug=${encodeURIComponent(slug)}`,
		);
	},

	/** Fetch the deep single-engagement projection for the Project Details sidebar. */
	detail(slug: string): Promise<ProjectsResult<{ detail: ProjectDetail }>> {
		return getProjects<{ detail: ProjectDetail }>(
			`/api/projects/detail?slug=${encodeURIComponent(slug)}`,
		);
	},

	/** Create a new engagement from the Create-Project modal payload. */
	create(payload: CreateProject): Promise<ProjectsResult<{ slug: string }>> {
		return postProjects<{ slug: string }>("/api/projects/create", payload);
	},

	/**
	 * Fetch the owner's editable configuration and its derived setup ladder.
	 *
	 * A separate read from {@link detail} because the two answer different questions: detail is the
	 * sidebar's showcase projection and carries no price, role or rule, so a progress bar built on it
	 * could only ever count a title.
	 */
	setup(slug: string): Promise<ProjectsResult<{ setup: ProjectSetup }>> {
		return getProjects<{ setup: ProjectSetup }>(
			`/api/projects/setup?slug=${encodeURIComponent(slug)}`,
		);
	},

	/**
	 * Save an edit to the configuration.
	 *
	 * The response carries the RE-DERIVED setup, not an acknowledgement: `completeness`,
	 * `previewReady` and the step ladder are server-computed, so the form adopts what came back as its
	 * new clean baseline rather than re-deriving them beside a number it did not produce.
	 */
	update(slug: string, patch: UpdateProject): Promise<ProjectsResult<{ setup: ProjectSetup }>> {
		return patchProjects<{ setup: ProjectSetup }>(
			`/api/projects/${encodeURIComponent(slug)}`,
			patch,
		);
	},

	/**
	 * Archive an engagement. A soft archive — the project leaves circulation, the row stays (root
	 * CLAUDE.md §5) — which is why the caller gets back the moment it happened rather than a bare
	 * confirmation.
	 */
	archive(
		slug: string,
		body: ArchiveProject = {},
	): Promise<ProjectsResult<{ slug: string; archivedAt: string }>> {
		return deleteProjects<{ slug: string; archivedAt: string }>(
			`/api/projects/${encodeURIComponent(slug)}`,
			body,
		);
	},
};

export type { ProjectDetail, ProjectFeedPayload, ProjectSetup, ProjectSummary };
