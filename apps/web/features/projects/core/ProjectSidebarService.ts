import { deleteProjects, getProjects, patchProjects, postProjects } from "./api.ts";
import { toSearchParams } from "./projects-state.ts";
import type { ProjectFeedParams } from "./projects-state.ts";
import type {
	ArchiveProject,
	CreatedProject,
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

/**
 * The DEV-ONLY onboarding simulation as a query fragment, or nothing.
 *
 * It rides the URL rather than the JSON body because it is not part of the resource: `sim` says what
 * a developer wants to LOOK at, and folding it into `UpdateProject` would make a switcher setting a
 * field of the project. The server validates it against its own union and discards it outside
 * development, so nothing here needs to know the members.
 *
 * `auto` is omitted rather than sent. The absence of a simulation and a simulation that simulates
 * nothing are the same request, and sending one of them would put a developer-only parameter on every
 * ordinary save.
 */
function withSim(url: string, sim?: string): string {
	if (!sim || sim === "auto") return url;
	// The separator is derived rather than hardcoded: one of the two call sites already carries a
	// query string and the other does not, and a `&` on a bare path produces a parameter named
	// `&sim` that the server silently never sees.
	return `${url}${url.includes("?") ? "&" : "?"}sim=${encodeURIComponent(sim)}`;
}

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

	/**
	 * Mint a draft from the Quick-Init payload.
	 *
	 * Returns BOTH identifiers. `id` is the canonical address the caller navigates to — a uuid cannot
	 * collide, cannot be squatted, and does not change when the owner renames the project, which a
	 * title-derived slug does on the first rename, i.e. almost immediately on a surface whose whole
	 * purpose is to finish configuring what was just created. `slug` rides along because every other
	 * projection in this domain carries one and a caller that wants a readable link should not have to
	 * re-read the row to get it.
	 */
	create(payload: CreateProject): Promise<ProjectsResult<CreatedProject>> {
		return postProjects<CreatedProject>("/api/projects/create", payload);
	},

	/**
	 * Fetch the owner's editable configuration and its derived setup ladder.
	 *
	 * A separate read from {@link detail} because the two answer different questions: detail is the
	 * sidebar's showcase projection and carries no price, role or rule, so a progress bar built on it
	 * could only ever count a title.
	 */
	setup(slug: string, sim?: string): Promise<ProjectsResult<{ setup: ProjectSetup }>> {
		return getProjects<{ setup: ProjectSetup }>(
			withSim(`/api/projects/setup?slug=${encodeURIComponent(slug)}`, sim),
		);
	},

	/**
	 * Save an edit to the configuration.
	 *
	 * The response carries the RE-DERIVED setup, not an acknowledgement: `completeness`,
	 * `previewReady` and the step ladder are server-computed, so the form adopts what came back as its
	 * new clean baseline rather than re-deriving them beside a number it did not produce.
	 */
	update(
		slug: string,
		patch: UpdateProject,
		sim?: string,
	): Promise<ProjectsResult<{ setup: ProjectSetup }>> {
		return patchProjects<{ setup: ProjectSetup }>(
			withSim(`/api/projects/${encodeURIComponent(slug)}`, sim),
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
